// Reusable avatar uploader. Uploads to the public `avatars` bucket under
// the current user's folder, and returns a public URL via onChange.
// Renders an editable circular avatar with hover overlay + remove option.
import { useCallback, useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface AvatarUploaderProps {
  /** Current avatar URL (public URL or null) */
  value: string | null | undefined;
  /** Called with the new public URL after successful upload, or null when removed. */
  onChange: (url: string | null) => void | Promise<void>;
  /** Used as a folder label inside the user's avatar storage path (e.g. "character", "persona/abc"). */
  scope: string;
  /** Fallback initial / character when no image is present. */
  fallback?: string;
  /** Tailwind size classes for the avatar circle. */
  sizeClass?: string;
  /** Border / accent color (any tailwind border color class). */
  ringClass?: string;
  /** When true the editor controls are hidden; renders display-only. */
  readOnly?: boolean;
  /** Optional shape: circle (default) or square (for character icon). */
  shape?: "circle" | "square";
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function AvatarUploader({
  value,
  onChange,
  scope,
  fallback = "?",
  sizeClass = "w-16 h-16",
  ringClass = "border-primary/40",
  readOnly = false,
  shape = "circle",
}: AvatarUploaderProps) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!user) {
        toast.error("Sign in to upload an avatar.");
        return;
      }
      if (!ALLOWED.includes(file.type)) {
        toast.error("Use PNG, JPG, WEBP or GIF.");
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error("Image must be under 5 MB.");
        return;
      }

      setBusy(true);
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const safeScope = scope.replace(/[^a-zA-Z0-9/_-]/g, "_");
        const path = `${user.id}/${safeScope}/${Date.now()}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, file, {
            contentType: file.type,
            cacheControl: "3600",
            upsert: false,
          });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
        await onChange(pub.publicUrl);
        toast.success("Avatar updated");
      } catch (e: any) {
        console.error("avatar upload failed", e);
        toast.error(`Upload failed: ${e?.message ?? "unknown error"}`);
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [user, scope, onChange],
  );

  const handleRemove = useCallback(async () => {
    if (!value) return;
    setBusy(true);
    try {
      // Best-effort: derive storage path from public URL and delete
      const marker = "/storage/v1/object/public/avatars/";
      const idx = value.indexOf(marker);
      if (idx !== -1) {
        const objectPath = decodeURIComponent(value.substring(idx + marker.length));
        await supabase.storage.from("avatars").remove([objectPath]).catch(() => {});
      }
      await onChange(null);
    } finally {
      setBusy(false);
    }
  }, [value, onChange]);

  const radius = shape === "circle" ? "rounded-full" : "rounded-xl";

  return (
    <div className={cn("relative group shrink-0", sizeClass)}>
      <div
        className={cn(
          "w-full h-full overflow-hidden border-2 flex items-center justify-center bg-muted/30",
          radius,
          ringClass,
        )}
      >
        {value ? (
          <img
            src={value}
            alt="avatar"
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="font-display font-bold text-foreground/70 text-lg">
            {fallback?.[0]?.toUpperCase() ?? "?"}
          </span>
        )}
      </div>

      {!readOnly && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            disabled={busy}
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity",
              radius,
            )}
            title={value ? "Replace avatar" : "Upload avatar"}
          >
            {busy ? (
              <Loader2 className="animate-spin text-primary" size={18} />
            ) : (
              <Camera className="text-primary" size={18} />
            )}
          </button>
          {value && !busy && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              className="absolute -top-1 -right-1 p-1 rounded-full border border-border bg-background text-muted-foreground hover:text-destructive hover:border-destructive/50 opacity-0 group-hover:opacity-100 transition-all"
              title="Remove avatar"
            >
              <Trash2 size={10} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
