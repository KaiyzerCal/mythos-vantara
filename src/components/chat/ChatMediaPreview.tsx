import { useState } from "react";
import { FileText, Video, Music, File as FileIcon, X } from "lucide-react";
import type { ChatAttachment } from "@/hooks/useChatAttachments";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ChatMediaPreview({ attachments }: { attachments: ChatAttachment[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  if (!attachments?.length) return null;

  const images = attachments.filter((a) => a.mime_type.startsWith("image/"));
  const others = attachments.filter((a) => !a.mime_type.startsWith("image/"));

  return (
    <div className="mb-2 space-y-1.5">
      {images.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {images.map((a) => (
            <button
              key={a.id}
              onClick={() => setLightbox(a.file_url)}
              className="relative rounded overflow-hidden border border-primary/20 hover:border-primary/40 transition-colors"
              title={a.file_name}
            >
              <img
                src={a.file_url}
                alt={a.file_name}
                className="block object-cover"
                style={{
                  maxHeight: images.length === 1 ? "180px" : "100px",
                  maxWidth: images.length === 1 ? "220px" : "130px",
                }}
              />
            </button>
          ))}
        </div>
      )}

      {others.map((a) => {
        const isVideo = a.mime_type.startsWith("video/");
        const isAudio = a.mime_type.startsWith("audio/");
        const isPdf = a.mime_type === "application/pdf";
        const isText = a.mime_type.startsWith("text/");
        const Icon = isVideo ? Video : isAudio ? Music : isPdf || isText ? FileText : FileIcon;

        return (
          <div
            key={a.id}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-muted/20 border border-border/40 text-xs font-mono w-fit max-w-[240px]"
          >
            <Icon size={12} className="text-muted-foreground shrink-0" />
            <span className="truncate text-foreground/80">{a.file_name}</span>
            <span className="text-muted-foreground/60 shrink-0">{formatBytes(a.file_size)}</span>
          </div>
        );
      })}

      {lightbox && (
        <div
          className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X size={20} />
          </button>
          <img
            src={lightbox}
            alt="preview"
            className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
