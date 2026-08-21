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
  storage_path: string | null;
  processing_status: "pending" | "processing" | "done" | "failed";
  extracted_text?: string;
  error_message?: string | null;
  created_at: string;
}

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

// chat-attachments is a private bucket, so file_url is a signed URL that expires.
// Anything older than the TTL — every image in a chat transcript a week later —
// renders as a broken thumbnail unless the URL is minted again at read time.
async function withFreshUrls(rows: ChatAttachment[]): Promise<ChatAttachment[]> {
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  if (paths.length === 0) return rows;
  const { data, error } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrls(paths, SIGNED_URL_TTL);
  if (error || !data) return rows;
  const byPath = new Map(data.map((d) => [d.path ?? "", d.signedUrl]));
  return rows.map((r) => {
    const fresh = r.storage_path ? byPath.get(r.storage_path) : undefined;
    return fresh ? { ...r, file_url: fresh } : r;
  });
}

export function useChatAttachments(chatKind: ChatKind, threadRef: string | null | undefined) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const pollRef = useRef<number | null>(null);
  // IDs that have been "sent" — excluded from refresh so the tray stays clear after send
  const sentIds = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!threadRef) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from("chat_attachments")
      .select("id,file_name,mime_type,file_url,file_size,storage_path,processing_status,extracted_text,error_message,created_at")
      .eq("user_id", session.user.id)
      .eq("chat_kind", chatKind)
      .eq("thread_ref", threadRef)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = ((data ?? []) as ChatAttachment[]).filter(a => !sentIds.current.has(a.id));
    setAttachments(await withFreshUrls(rows));
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
          toast.error(`Upload failed: ${file.name}`, { description: upErr.message });
          continue;
        }

        const { data: signed } = await supabase.storage
          .from("chat-attachments")
          .createSignedUrl(path, SIGNED_URL_TTL);

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
          toast.error(`DB write failed: ${file.name}`, { description: rowErr?.message });
          // The object is already in storage; drop it so a retry isn't blocked
          // by an orphan and the bucket doesn't accumulate unreferenced files.
          await supabase.storage.from("chat-attachments").remove([path]).catch(() => {});
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
      // Delete from DB first, but capture storage_path from local state beforehand
      await supabase.from("chat_attachments").delete().eq("id", id);
      // best-effort storage cleanup using the path already in local state
      if (target?.storage_path) {
        await supabase.storage.from("chat-attachments").remove([target.storage_path]).catch(() => {});
      }
    } catch (e) {
      console.error("delete attachment failed", e);
    }
  }, [attachments]);

  // Clears the staging tray without deleting DB rows (MAVIS still reads them via attachmentIds)
  const clearStaged = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((a) => sentIds.current.add(a.id));
      return [];
    });
  }, []);

  return { attachments, isUploading, upload, remove, refresh, clearStaged };
}
