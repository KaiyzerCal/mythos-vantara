// Reusable upload hook for chat attachments. Handles upload to storage, row
// insert into chat_attachments, and triggers server-side processing.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ChatKind = "mavis" | "council" | "persona";

export interface ChatAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  file_url: string;
  file_size: number;
  processing_status: "pending" | "processing" | "done" | "failed";
  extracted_text?: string;
  created_at: string;
}

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file

export function useChatAttachments(chatKind: ChatKind, threadRef: string | null | undefined) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!threadRef) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from("chat_attachments")
      .select("id,file_name,mime_type,file_url,file_size,processing_status,extracted_text,created_at")
      .eq("user_id", session.user.id)
      .eq("chat_kind", chatKind)
      .eq("thread_ref", threadRef)
      .order("created_at", { ascending: false })
      .limit(50);
    setAttachments((data ?? []) as ChatAttachment[]);
  }, [chatKind, threadRef]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while any attachment is still processing
  useEffect(() => {
    const pending = attachments.some(
      (a) => a.processing_status === "pending" || a.processing_status === "processing",
    );
    if (!pending) {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = window.setTimeout(() => {
      refresh();
    }, 3000);
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [attachments, refresh]);

  const upload = useCallback(async (files: FileList | File[]) => {
    if (!threadRef) {
      toast.error("Open a chat thread before uploading.");
      return [];
    }
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return [];
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      toast.error("Sign in to upload files.");
      return [];
    }
    setIsUploading(true);
    const created: ChatAttachment[] = [];
    try {
      for (const file of fileArr) {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} exceeds 50 MB limit.`);
          continue;
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${session.user.id}/${chatKind}/${threadRef}/${Date.now()}-${safeName}`;

        const { error: upErr } = await supabase.storage
          .from("chat-attachments")
          .upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (upErr) {
          console.error("upload failed", upErr);
          toast.error(`Upload failed: ${file.name}`);
          continue;
        }

        const { data: signed } = await supabase.storage
          .from("chat-attachments")
          .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 day signed URL

        const { data: row, error: rowErr } = await supabase
          .from("chat_attachments")
          .insert({
            user_id: session.user.id,
            chat_kind: chatKind,
            thread_ref: threadRef,
            file_name: file.name,
            mime_type: file.type || "application/octet-stream",
            file_type: file.type?.split("/")[0] || "document",
            file_url: signed?.signedUrl ?? "",
            storage_path: path,
            file_size: file.size,
            processing_status: "pending",
          })
          .select()
          .single();

        if (rowErr || !row) {
          console.error("row insert failed", rowErr);
          toast.error(`DB write failed: ${file.name}`);
          continue;
        }

        created.push(row as ChatAttachment);

        // Fire-and-forget process call
        supabase.functions
          .invoke("mavis-attachment-process", { body: { attachment_id: row.id } })
          .then(({ error }) => {
            if (error) console.error("processing error", error);
            refresh();
          });
      }

      if (created.length > 0) {
        setAttachments((prev) => [...created, ...prev]);
        toast.success(`${created.length} file${created.length > 1 ? "s" : ""} uploaded — processing...`);
      }
    } finally {
      setIsUploading(false);
    }
    return created;
  }, [chatKind, threadRef, refresh]);

  const remove = useCallback(async (id: string) => {
    const target = attachments.find((a) => a.id === id);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    try {
      await supabase.from("chat_attachments").delete().eq("id", id);
      // best-effort storage cleanup (ignore failures)
      if (target) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          // we don't have storage_path in the local row, so re-fetch quickly
          const { data: row } = await supabase
            .from("chat_attachments")
            .select("storage_path")
            .eq("id", id)
            .maybeSingle();
          if (row?.storage_path) {
            await supabase.storage.from("chat-attachments").remove([row.storage_path]).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.error("delete attachment failed", e);
    }
  }, [attachments]);

  return { attachments, isUploading, upload, remove, refresh };
}
