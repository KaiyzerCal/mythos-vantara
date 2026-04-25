import { useRef } from "react";
import { Paperclip, X, Loader2, FileText, Image as ImageIcon, Music, Video, File as FileIcon } from "lucide-react";
import type { ChatAttachment } from "@/hooks/useChatAttachments";

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon size={11} />;
  if (mime.startsWith("audio/")) return <Music size={11} />;
  if (mime.startsWith("video/")) return <Video size={11} />;
  if (mime === "application/pdf" || mime.startsWith("text/")) return <FileText size={11} />;
  return <FileIcon size={11} />;
}

interface AttachmentTrayProps {
  attachments: ChatAttachment[];
  isUploading: boolean;
  onUpload: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}

export function AttachmentTray({
  attachments,
  isUploading,
  onUpload,
  onRemove,
  compact,
}: AttachmentTrayProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1.5">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.slice(0, 8).map((a) => {
            const status = a.processing_status;
            const statusColor =
              status === "done" ? "text-emerald-400 border-emerald-400/30"
              : status === "failed" ? "text-destructive border-destructive/30"
              : "text-muted-foreground border-border animate-pulse";
            return (
              <div
                key={a.id}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded border bg-muted/20 ${statusColor}`}
                title={`${a.file_name} — ${status}${a.extracted_text ? ` — ${a.extracted_text.slice(0, 200)}…` : ""}`}
              >
                {iconFor(a.mime_type)}
                <span className="max-w-[120px] truncate">{a.file_name}</span>
                {status !== "done" && status !== "failed" && (
                  <Loader2 size={10} className="animate-spin" />
                )}
                <button
                  onClick={() => onRemove(a.id)}
                  className="text-muted-foreground hover:text-destructive ml-0.5"
                  title="Remove"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
          {attachments.length > 8 && (
            <span className="text-[10px] font-mono text-muted-foreground self-center">
              +{attachments.length - 8} more
            </span>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*,application/pdf,text/*,.doc,.docx,.txt,.md,.json,.csv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onUpload(e.target.files);
            e.target.value = "";
          }
        }}
      />
      {!compact && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-50"
        >
          {isUploading ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />}
          {isUploading ? "Uploading..." : "Attach files"}
        </button>
      )}
    </div>
  );
}

interface AttachButtonProps {
  isUploading: boolean;
  onUpload: (files: FileList | File[]) => void;
  className?: string;
}

export function AttachButton({ isUploading, onUpload, className }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*,application/pdf,text/*,.doc,.docx,.txt,.md,.json,.csv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onUpload(e.target.files);
            e.target.value = "";
          }
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className={className ?? "px-2.5 py-2 bg-muted/30 border border-border rounded text-muted-foreground hover:text-primary hover:border-primary/40 transition-all disabled:opacity-40"}
        title="Attach files (images, docs, audio, video)"
      >
        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
      </button>
    </>
  );
}
