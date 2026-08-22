import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/SharedUI";
import { LoadingState } from "@/components/LoadingState";
import { Loader2, Image, Music, Video, Globe, Download, ExternalLink, RefreshCw, Grid3X3, Wand2, Send, Sparkles, Film, Camera, Upload, Play, Trash2, Pencil, X, Maximize2, History } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";


interface MediaItem {
  id: string;
  type: "image" | "audio" | "video" | "poster";
  url: string;
  title: string;
  provider?: string;
  created_at: string;
  extra?: Record<string, unknown>;
  // Delete is only offered for vault_media-sourced items (raw_id = that
  // row's real id). Items sourced from mavis_social_posts are a different
  // feature's post-history record (draft/scheduled/posted, may reference a
  // real published external_id) — editing their media_urls array from here
  // would reach into that data model's semantics, so they're shown
  // read-only (view/download only, no delete affordance).
  source?: "vault" | "social";
  raw_id?: string;
  // vault_media columns the edit sheet writes back to
  description?: string;
  tags?: string[];
}

// vault_media.file_type is written by half a dozen callers and is not
// consistently a MIME type: mavis-chat and mavis-actions store the bare word
// "image", the doc extractor may leave it empty. The old check was
// `!fileType.startsWith("image/") -> skip`, so every bare-"image" row — i.e.
// everything MAVIS generated in chat — was dropped from the gallery instead of
// being shown. Classify on the leading token and fall back to the URL.
function classify(fileType: string, url: string): MediaItem["type"] | null {
  const t = (fileType ?? "").toLowerCase().trim();
  const head = t.split("/")[0];

  if (head === "audio" || /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i.test(url)) return "audio";
  if (head === "video" || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return "video";
  if (/\.html?(\?|$)/i.test(url) || t === "text/html") return "poster";
  if (head === "image" || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(url)) return "image";
  if (url.startsWith("data:image/")) return "image";
  // Unknown type with no usable extension — a generated asset served from a
  // bare URL is far more likely to be an image than nothing, and showing it
  // with a broken-image fallback beats hiding the row entirely.
  return t === "" ? "image" : null;
}

// vault-media is a PRIVATE bucket (made private in 20260331225024), but
// mavis-chat and mavis-actions both persist getPublicUrl() results into
// file_url. Those URLs 400 for everyone, which is why generated media showed
// up as broken tiles. Detect them and mint a signed URL at read time.
const VAULT_PUBLIC_MARKER = "/storage/v1/object/public/vault-media/";

function vaultObjectPath(url: string): string | null {
  const idx = url.indexOf(VAULT_PUBLIC_MARKER);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + VAULT_PUBLIC_MARKER.length).split("?")[0]);
}

// A re-signed URL looks like /storage/v1/object/sign/vault-media/<path>?token=…
const VAULT_SIGNED_MARKER = "/storage/v1/object/sign/vault-media/";

function signedVaultObjectPath(url: string): string | null {
  const idx = url.indexOf(VAULT_SIGNED_MARKER);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + VAULT_SIGNED_MARKER.length).split("?")[0]);
}

// Covers both stored forms: the dead public URL, and a previously-signed URL
// whose token has since expired. Re-signing on every load keeps the gallery
// self-healing instead of decaying into broken tiles.
function vaultPathOf(url: string): string | null {
  return vaultObjectPath(url) ?? signedVaultObjectPath(url);
}

async function repairVaultUrls(items: MediaItem[]): Promise<MediaItem[]> {
  const paths = items.map(i => vaultPathOf(i.url)).filter((p): p is string => !!p);
  if (paths.length === 0) return items;
  const { data, error } = await supabase.storage
    .from("vault-media")
    .createSignedUrls([...new Set(paths)], 60 * 60 * 24 * 7);
  if (error || !data) return items;
  const byPath = new Map(data.map(d => [d.path ?? "", d.signedUrl]));
  return items.map(i => {
    const path = vaultPathOf(i.url);
    const signed = path ? byPath.get(path) : undefined;
    return signed ? { ...i, url: signed } : i;
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Full-size preview. Several providers (PromptChan, ModelsLab, Imagen4,
// Lovable) return `data:image/...;base64,...` URIs instead of hosted URLs
// -- modern browsers block top-level navigation to data: URIs opened via
// `<a target="_blank">` as an anti-phishing measure, so that "Open"
// affordance silently does nothing for a large share of generated images.
// An <img> tag isn't subject to that restriction, so an in-app overlay is
// the only reliable way to show a full-size preview regardless of URL type.
function Lightbox({ item, onClose }: { item: { url: string; type: "image" | "video"; title?: string } | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6"
          onClick={onClose}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
          {item.type === "video" ? (
            <video
              src={item.url}
              controls
              autoPlay
              className="max-w-full max-h-full rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={item.url}
              alt={item.title ?? "Preview"}
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Edit sheet for vault_media rows. file_name / description / tags are the
// only user-owned columns on that table; everything else is provenance written
// by whichever generator or uploader created the row.
function EditSheet({
  item,
  onClose,
  onSaved,
}: {
  item: MediaItem | null;
  onClose: () => void;
  onSaved: (patch: { raw_id: string; title: string; description: string; tags: string[] }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagText, setTagText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever a different item is opened.
  useEffect(() => {
    if (!item) return;
    setTitle(item.title ?? "");
    setDescription(item.description ?? "");
    setTagText((item.tags ?? []).join(", "));
    setError(null);
  }, [item]);

  const save = async () => {
    if (!item?.raw_id || saving) return;
    const trimmed = title.trim();
    if (!trimmed) { setError("Name can't be empty."); return; }
    const tags = tagText.split(",").map(t => t.trim()).filter(Boolean);
    setSaving(true);
    setError(null);
    try {
      const { error: updErr } = await (supabase as any)
        .from("vault_media")
        .update({ file_name: trimmed, description: description.trim(), tags })
        .eq("id", item.raw_id);
      if (updErr) throw updErr;
      onSaved({ raw_id: item.raw_id, title: trimmed, description: description.trim(), tags });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-border bg-card p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-mono text-foreground">Edit asset</h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Close">
                <X size={15} />
              </button>
            </div>

            {item.type === "image" && (
              <img src={item.url} alt={item.title} className="w-full h-32 object-cover rounded border border-border" />
            )}

            <label className="block space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">Name</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-border bg-background text-foreground focus:border-primary/50 outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-border bg-background text-foreground focus:border-primary/50 outline-none resize-y"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">Tags (comma separated)</span>
              <input
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                placeholder="generated, poster, draft"
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-border bg-background text-foreground focus:border-primary/50 outline-none"
              />
            </label>

            {error && <p className="text-[10px] font-mono text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-mono rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 size={11} className="animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type FilterType = "all" | "image" | "audio" | "video" | "poster";

const FILTER_ICONS: Record<FilterType, React.ReactNode> = {
  all:    <Grid3X3 size={12} />,
  image:  <Image size={12} />,
  audio:  <Music size={12} />,
  video:  <Video size={12} />,
  poster: <Globe size={12} />,
};

function MediaCard({ item, onSendToVideo, onDelete, onEdit, onPreview }: { item: MediaItem; onSendToVideo?: (url: string) => void; onDelete?: (item: MediaItem) => void; onEdit?: (item: MediaItem) => void; onPreview?: (item: MediaItem) => void }) {
  const [imgError, setImgError] = useState(false);
  const previewable = onPreview && (item.type === "image" || item.type === "video");

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className="group relative rounded-lg border border-border overflow-hidden bg-card hover:border-primary/50 hover:shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.35)] transition-all"
    >
      {/* Preview area */}
      <div
        className={`relative bg-muted/20 aspect-square overflow-hidden ${previewable ? "cursor-zoom-in" : ""}`}
        onClick={previewable ? () => onPreview!(item) : undefined}
      >
        {item.type === "image" && !imgError && (
          <img
            src={item.url}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        )}
        {(item.type === "image" && imgError) && (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Image size={24} />
          </div>
        )}
        {item.type === "audio" && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-primary/50">
            <Music size={28} className="text-primary" />
            <span className="text-[10px] font-mono text-muted-foreground">{item.provider ?? "audio"}</span>
            <audio src={item.url} controls className="w-full px-2 max-w-[120px]" style={{ height: 28 }} />
          </div>
        )}
        {item.type === "video" && (
          <video
            src={item.url}
            muted
            playsInline
            className="w-full h-full object-cover"
            onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
            onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
          />
        )}
        {item.type === "poster" && (
          <div className="w-full h-full flex items-center justify-center text-primary/50 bg-gradient-to-br from-primary/5 to-transparent">
            <Globe size={28} className="text-primary" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {previewable ? (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPreview!(item); }}
              className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              title="Preview full size"
            >
              <Maximize2 size={13} />
            </button>
          ) : (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              title="Open"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <a
            href={item.url}
            download
            onClick={(e) => e.stopPropagation()}
            className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            title="Download"
          >
            <Download size={13} />
          </a>
          {item.type === "image" && onSendToVideo && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSendToVideo(item.url); }}
              className="w-8 h-8 rounded-full bg-primary/30 border border-primary/50 flex items-center justify-center text-white hover:bg-primary/50 transition-colors"
              title="Animate → Video"
            >
              <Play size={13} />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(item); }}
              className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              title="Edit name, description, tags"
            >
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(item); }}
              className="w-8 h-8 rounded-full bg-destructive/20 border border-destructive/40 flex items-center justify-center text-white hover:bg-destructive/50 transition-colors"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {/* Type badge */}
        <div className="absolute top-1.5 left-1.5">
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white/70 capitalize">
            {item.type}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="px-2.5 py-2">
        <p className="text-xs font-mono truncate text-foreground/80" title={item.title}>{item.title}</p>
        {item.description && (
          <p className="text-[9px] font-mono text-muted-foreground/80 truncate mt-0.5" title={item.description}>
            {item.description}
          </p>
        )}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.tags.slice(0, 3).map(t => (
              <span key={t} className="text-[8px] font-mono px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">
                {t}
              </span>
            ))}
            {item.tags.length > 3 && (
              <span className="text-[8px] font-mono text-muted-foreground">+{item.tags.length - 3}</span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between mt-0.5">
          {item.provider && (
            <span className="text-[9px] font-mono text-muted-foreground">{item.provider}</span>
          )}
          <span className="text-[9px] font-mono text-muted-foreground ml-auto">{timeAgo(item.created_at)}</span>
        </div>
      </div>
    </motion.div>
  );
}

const SIZE_OPTIONS = [
  { key: "square",    label: "Square",   w: 1024, h: 1024, desc: "1:1 — profile, post" },
  { key: "portrait",  label: "Story",    w: 768,  h: 1344, desc: "9:16 — Reels, Stories" },
  { key: "landscape", label: "Wide",     w: 1344, h: 768,  desc: "16:9 — banner, thumbnail" },
  { key: "poster",    label: "Poster",   w: 864,  h: 1152, desc: "3:4 — print poster, flyer" },
] as const;

const IMAGE_PROVIDERS = [
  { key: "auto",             label: "Auto",         hint: "smart cascade" },
  { key: "flux-pro",         label: "FLUX 1.1 Pro", hint: "photoreal, fal.ai" },
  { key: "imagen-4",         label: "Imagen 4",     hint: "Google, sharp" },
  { key: "openai",           label: "GPT Image",    hint: "OpenAI, versatile" },
  { key: "modelslab",        label: "ModelsLab",    hint: "SDXL/FLUX, uncensored" },
  { key: "pollinations",     label: "Pollinations", hint: "free FLUX" },
  { key: "promptchan",       label: "PromptChan",   hint: "NSFW-capable" },
] as const;

// Small per-browser prompt history so a generator's last few prompts can be
// clicked back into the box instead of retyped. Deliberately localStorage,
// not a table — this is a personal recency list, not data the app needs
// elsewhere.
function useRecentPrompts(key: string, max = 8) {
  const storageKey = `mavis:gallery:${key}`;
  const [items, setItems] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const add = useCallback((prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setItems(prev => {
      const next = [trimmed, ...prev.filter(p => p !== trimmed)].slice(0, max);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore quota errors */ }
      return next;
    });
  }, [storageKey, max]);

  return [items, add] as const;
}

function RecentPrompts({ items, onPick }: { items: string[]; onPick: (prompt: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground uppercase tracking-wide">
        <History size={10} /> Recent
      </span>
      {items.map(p => (
        <button
          key={p}
          onClick={() => onPick(p)}
          title={p}
          className="text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors max-w-[160px] truncate"
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function ImageGenPanel({ onGenerated, onPreview }: { onGenerated: (item: MediaItem) => void; onPreview?: (url: string) => void }) {
  const { session } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<typeof SIZE_OPTIONS[number]["key"]>("square");
  const [imgProvider, setImgProvider] = useState<typeof IMAGE_PROVIDERS[number]["key"]>("auto");
  const [generating, setGenerating] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [recentPrompts, addRecentPrompt] = useRecentPrompts("image-prompts");

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setLastUrl(null);
    try {
      const s = SIZE_OPTIONS.find(o => o.key === size)!;
      const { data, error } = await (supabase as any).functions.invoke("mavis-image-gen", {
        body: imgProvider === "promptchan"
          // PromptChan doesn't take the SFW cascade's photographic-realism
          // prompt suffix or size/aspect_ratio params — mavis-image-gen
          // ignores those for this provider anyway.
          ? { prompt: prompt.trim(), provider: "promptchan" }
          : {
              prompt: `${prompt.trim()}, ultra-detailed, razor-sharp focus, natural lighting, cinematic composition, shot on Hasselblad, photographic realism, fine texture detail`,
              width: s.w,
              height: s.h,
              size: `${s.w}x${s.h}`,
              quality: "high",
              aspect_ratio: s.w === s.h ? "1:1" : s.w > s.h ? "16:9" : "9:16",
              provider: imgProvider,
            },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });


      if (error) throw error;
      if (!data?.url) throw new Error(data?.error ?? "No image URL returned");
      setLastUrl(data.url);
      addRecentPrompt(prompt.trim());

      // Persist to vault_media so it shows up in the gallery on next load —
      // capture the row id back so the card can be deleted immediately
      // without needing a refresh first.
      let savedId: string | null = null;
      let savedCreatedAt: string | null = null;
      if (session?.user) {
        const { data: row } = await (supabase as any).from("vault_media").insert({
          user_id: session.user.id,
          file_name: prompt.trim().slice(0, 80),
          file_type: "image/png",
          file_url: data.url,
          description: prompt.trim(),
          tags: ["generated", data.provider ?? "ai", `${s.w}x${s.h}`],
        }).select("id, created_at").single();
        savedId = row?.id ?? null;
        savedCreatedAt = row?.created_at ?? null;
      }

      onGenerated({
        id: savedId ? `vault-${savedId}` : `gen-${Date.now()}`,
        source: savedId ? "vault" : undefined,
        raw_id: savedId ?? undefined,
        type: "image",
        url: data.url,
        title: prompt.trim().slice(0, 80),
        provider: data.provider ?? "ai",
        created_at: savedCreatedAt ?? new Date().toISOString(),
        extra: { prompt, width: s.w, height: s.h },
      });
    } catch (e: any) {
      toast.error("Image generation failed", {
        description: `${e?.message ?? "unknown error"} — check that an image provider key (OPENAI_API / FAL_API_KEY / GEMINI_API_KEY) is set in Supabase secrets.`,
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Wand2 size={14} className="text-primary" />
        <span className="text-xs font-mono text-foreground font-medium">Generate Image</span>
      </div>

      {/* Prompt */}
      <div className="flex gap-2">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); }}}
          placeholder="Describe what you want to create… (e.g. a minimalist startup logo in dark blue)"
          rows={2}
          className="flex-1 text-xs font-mono bg-muted/30 border border-border rounded-lg px-3 py-2 resize-none outline-none placeholder:text-muted-foreground focus:border-primary/50 transition-colors"
        />
        <button
          onClick={generate}
          disabled={generating || !prompt.trim()}
          className="w-10 h-full rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center shrink-0"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>

      {/* Provider selector — promptchan is just another entry here now,
          no separate toggle or gate. */}
      <div className="flex flex-wrap gap-1.5">
        {IMAGE_PROVIDERS.map(p => (
          <button
            key={p.key}
            onClick={() => setImgProvider(p.key)}
            title={p.hint}
            className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors flex items-center gap-1 ${
              imgProvider === p.key
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
          >
            {p.label}
            {p.key === "pollinations" && (
              <span className="text-[8px] px-1 rounded bg-green-900/40 text-green-400">free</span>
            )}
          </button>
        ))}
      </div>

      <RecentPrompts items={recentPrompts} onPick={setPrompt} />

      {/* Size selector — not used by PromptChan, but harmless to leave
          visible/selectable; mavis-image-gen ignores it for that provider. */}
      {imgProvider !== "promptchan" && (
      <div className="flex flex-wrap gap-1.5">
        {SIZE_OPTIONS.map(o => (
          <button
            key={o.key}
            onClick={() => setSize(o.key)}
            title={o.desc}
            className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
              size === o.key
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
          >
            {o.label} <span className="opacity-50">{o.desc.split("—")[0].trim()}</span>
          </button>
        ))}
      </div>
      )}

      {/* Preview of last result */}
      {lastUrl && (
        <div className="flex gap-3 items-start mt-1">
          <button onClick={() => onPreview?.(lastUrl)} className="shrink-0 cursor-zoom-in" title="Preview full size">
            <img src={lastUrl} alt="Generated" className="w-20 h-20 rounded-lg object-cover border border-border" />
          </button>
          <div className="flex flex-col gap-1.5 min-w-0">
            <p className="text-[10px] font-mono text-muted-foreground truncate">{prompt}</p>
            <div className="flex gap-1.5">
              <button onClick={() => onPreview?.(lastUrl)}
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-1">
                <Maximize2 size={9} /> Preview
              </button>
              <a href={lastUrl} download className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-1">
                <Download size={9} /> Download
              </a>
              <button onClick={() => { setPrompt(""); setLastUrl(null); }}
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-1">
                <Sparkles size={9} /> New
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CAMERA_MOTIONS = [
  { key: "static",       label: "Static",       hint: "no camera movement" },
  { key: "zoom_in",      label: "Zoom In",      hint: "slow push toward subject" },
  { key: "zoom_out",     label: "Zoom Out",     hint: "pull back reveal" },
  { key: "pan_left",     label: "Pan Left",     hint: "camera pans left" },
  { key: "pan_right",    label: "Pan Right",    hint: "camera pans right" },
  { key: "orbit_left",   label: "Orbit L",      hint: "circle subject left" },
  { key: "orbit_right",  label: "Orbit R",      hint: "circle subject right" },
  { key: "crane_up",     label: "Crane Up",     hint: "rise from ground" },
  { key: "handheld",     label: "Handheld",     hint: "organic natural sway" },
  { key: "dolly_zoom",   label: "Dolly Zoom",   hint: "vertigo effect" },
] as const;

const VIDEO_ASPECTS = [
  { key: "9:16",  label: "Vertical",  desc: "Reels, TikTok, Stories" },
  { key: "16:9",  label: "Widescreen", desc: "YouTube, cinematic" },
  { key: "1:1",   label: "Square",    desc: "Feed post" },
] as const;

const VIDEO_PROVIDERS = [
  { key: "higgsfield", label: "Higgsfield",  hint: "cinematic camera control" },
  { key: "kling",      label: "Kling",       hint: "fal.ai, strong motion" },
  { key: "fal",        label: "Seedance",    hint: "fal.ai general" },
  { key: "runway",     label: "Runway",      hint: "Runway Gen-3" },
  { key: "veo",        label: "Veo",         hint: "Google Veo" },
  { key: "modelslab",  label: "ModelsLab",   hint: "SDXL video, uncensored" },
  { key: "promptchan", label: "PromptChan",  hint: "NSFW, text-only — cannot animate a reference image" },
] as const;

function VideoGenPanel({ onGenerated, seedImageUrl, onPreview }: { onGenerated: (item: MediaItem) => void; seedImageUrl?: string | null; onPreview?: (url: string) => void }) {
  const { session } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [cameraMotion, setCameraMotion] = useState<typeof CAMERA_MOTIONS[number]["key"]>("zoom_in");
  const [aspect, setAspect] = useState<typeof VIDEO_ASPECTS[number]["key"]>("9:16");
  const [duration, setDuration] = useState<4 | 6 | 8>(4);
  const [videoProvider, setVideoProvider] = useState<typeof VIDEO_PROVIDERS[number]["key"]>("higgsfield");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [recentPrompts, addRecentPrompt] = useRecentPrompts("video-prompts");

  useEffect(() => {
    if (seedImageUrl) setImageUrl(seedImageUrl);
  }, [seedImageUrl]);



  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !session?.user) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${session.user.id}/video-refs/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (err: any) {
      toast.error("Upload failed", { description: err.message });
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setLastUrl(null);
    try {
      let data: any; let error: any; let url: string | undefined; let jobId: string | undefined;

      if (videoProvider === "higgsfield") {
        ({ data, error } = await (supabase as any).functions.invoke("mavis-higgsfield", {
          body: {
            userId: session?.user?.id,
            action: "generate_video",
            prompt: prompt.trim(),
            image_url: imageUrl || undefined,
            camera_motion: cameraMotion,
            aspect_ratio: aspect,
            duration,
            max_attempts: 30,
            poll_interval_ms: 5000,
          },
        }));
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        url = data?.video_url;
        jobId = data?.video_id;
      } else {
        ({ data, error } = await (supabase as any).functions.invoke("mavis-video-gen", {
          body: {
            prompt: `${prompt.trim()}${cameraMotion && cameraMotion !== "static" ? ` — camera: ${cameraMotion}` : ""}`,
            image_url: imageUrl || undefined,
            aspect_ratio: aspect,
            duration,
            provider: videoProvider,
          },
        }));
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        url = data?.url ?? data?.video_url;
        jobId = data?.request_id ?? data?.operation_name;
      }

      if (url) {
        setLastUrl(url);
        addRecentPrompt(prompt.trim());
        let savedId: string | null = null;
        let savedCreatedAt: string | null = null;
        if (session?.user) {
          const { data: row } = await (supabase as any).from("vault_media").insert({
            user_id: session.user.id,
            file_name: prompt.trim().slice(0, 80),
            file_type: "video/mp4",
            file_url: url,
            description: prompt.trim(),
            tags: ["generated", videoProvider, cameraMotion, aspect, `${duration}s`],
          }).select("id, created_at").single();
          savedId = row?.id ?? null;
          savedCreatedAt = row?.created_at ?? null;
        }
        onGenerated({
          id: savedId ? `vault-${savedId}` : `vid-${Date.now()}`,
          source: savedId ? "vault" : undefined,
          raw_id: savedId ?? undefined,
          type: "video",
          url,
          title: prompt.trim().slice(0, 80),
          provider: videoProvider,
          created_at: savedCreatedAt ?? new Date().toISOString(),
          extra: { cameraMotion, aspect, duration },
        });
      } else {
        toast.info("Still processing", {
          description: `Job ${jobId ?? "?"} — it will appear in the gallery once ready.`,
        });
      }
    } catch (e: any) {
      toast.error("Video generation failed", { description: e?.message ?? "unknown error" });
    } finally {
      setGenerating(false);
    }
  }


  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Film size={14} className="text-primary" />
        <span className="text-xs font-mono text-foreground font-medium">Generate Video</span>
        <span className="text-[9px] font-mono text-muted-foreground ml-auto">{VIDEO_PROVIDERS.find(p => p.key === videoProvider)?.label}</span>
      </div>

      {/* Provider selector */}
      <div className="flex flex-wrap gap-1.5">
        {VIDEO_PROVIDERS.map(p => (
          <button
            key={p.key}
            onClick={() => setVideoProvider(p.key)}
            title={p.hint}
            className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
              videoProvider === p.key
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <RecentPrompts items={recentPrompts} onPick={setPrompt} />

      <div className="flex gap-2">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe the shot… (e.g. a woman walking through neon-lit tokyo at night, film grain, cinematic)"
          rows={2}
          className="flex-1 text-xs font-mono bg-muted/30 border border-border rounded-lg px-3 py-2 resize-none outline-none placeholder:text-muted-foreground focus:border-primary/50 transition-colors"
        />
        <button
          onClick={generate}
          disabled={generating || !prompt.trim()}
          className="w-10 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center shrink-0"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>

      {/* Optional reference image */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-mono px-2 py-1 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-1 cursor-pointer">
          <Upload size={10} /> {uploading ? "Uploading…" : "Add reference image (optional)"}
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </label>
        {imageUrl && (
          <>
            <img src={imageUrl} alt="ref" className="w-8 h-8 rounded object-cover border border-border" />
            <button onClick={() => setImageUrl("")} className="text-[10px] font-mono text-muted-foreground hover:text-primary">clear</button>
          </>
        )}
      </div>
      {imageUrl && videoProvider === "promptchan" && (
        <p className="text-[10px] font-mono text-amber-500">
          PromptChan video is text-only — it will ignore this reference image and generate from the prompt alone.
        </p>
      )}

      {/* Camera motion */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Camera size={10} className="text-muted-foreground" />
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Camera Motion</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CAMERA_MOTIONS.map(m => (
            <button
              key={m.key}
              onClick={() => setCameraMotion(m.key as any)}
              title={m.hint}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                cameraMotion === m.key
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Aspect + duration */}
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-wrap gap-1.5">
          {VIDEO_ASPECTS.map(a => (
            <button
              key={a.key}
              onClick={() => setAspect(a.key)}
              title={a.desc}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                aspect === a.key
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {a.label} <span className="opacity-50">{a.key}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {([4, 6, 8] as const).map(d => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                duration === d
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {d}s
            </button>
          ))}
        </div>
      </div>

      {lastUrl && (
        <div className="flex gap-3 items-start mt-1">
          <button onClick={() => onPreview?.(lastUrl)} className="shrink-0 cursor-zoom-in" title="Preview full size">
            <video src={lastUrl} className="w-24 h-24 rounded-lg object-cover border border-border" muted autoPlay loop playsInline />
          </button>
          <div className="flex flex-col gap-1.5 min-w-0">
            <p className="text-[10px] font-mono text-muted-foreground truncate">{prompt}</p>
            <div className="flex gap-1.5">
              <button onClick={() => onPreview?.(lastUrl)}
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-1">
                <Maximize2 size={9} /> Preview
              </button>
              <a href={lastUrl} download className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-1">
                <Download size={9} /> Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function GalleryPage() {

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [genMode, setGenMode] = useState<"image" | "video">("image");
  const [seedImageUrl, setSeedImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<{ url: string; type: "image" | "video"; title?: string } | null>(null);
  const [editItem, setEditItem] = useState<MediaItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleSendToVideo = useCallback((url: string) => {
    setSeedImageUrl(url);
    setGenMode("video");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleEditSaved = useCallback((patch: { raw_id: string; title: string; description: string; tags: string[] }) => {
    setItems(prev => prev.map(i =>
      i.raw_id === patch.raw_id
        ? { ...i, title: patch.title, description: patch.description, tags: patch.tags }
        : i,
    ));
  }, []);

  // window.confirm() is unreliable in a WebView — without a JS-dialog handler it
  // resolves false without ever showing anything, which silently swallowed every
  // delete. An in-app dialog does not depend on the host providing one.
  const handleDelete = useCallback((item: MediaItem) => {
    if (!item.raw_id) return;
    setPendingDelete(item);
  }, []);

  const confirmDelete = useCallback(async () => {
    const item = pendingDelete;
    if (!item?.raw_id || deleting) return;
    setDeleting(true);
    try {
      const { error } = await (supabase as any).from("vault_media").delete().eq("id", item.raw_id);
      if (error) throw error;
      // Best-effort storage cleanup — only applies to files actually
      // uploaded to Supabase Storage (the "avatars" bucket, via the
      // Upload button or the /gallery generators below); externally-hosted
      // provider URLs (fal.ai, pollinations, etc.) and base64 data URIs
      // don't match this pattern and are silently skipped.
      const marker = "/storage/v1/object/public/avatars/";
      const idx = item.url.indexOf(marker);
      if (idx !== -1) {
        const path = decodeURIComponent(item.url.slice(idx + marker.length).split("?")[0]);
        await supabase.storage.from("avatars").remove([path]).catch(() => {});
      }
      // Generated assets live in the private vault-media bucket. Their card URL
      // has been re-signed for display, so recover the object path from the
      // signed form as well as the stale public form.
      const vaultPath = vaultPathOf(item.url);
      if (vaultPath) {
        await supabase.storage.from("vault-media").remove([vaultPath]).catch(() => {});
      }
      setItems(prev => prev.filter(i => i.id !== item.id));
      setPendingDelete(null);
      toast.success("Deleted", { description: item.title });
    } catch (e: any) {
      toast.error("Delete failed", { description: e?.message ?? "unknown error" });
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, deleting]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file afterward
    if (!file) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { toast.error("Sign in to upload."); return; }
    setUploading(true);
    try {
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      // The "avatars" bucket's RLS policies key off (storage.foldername(name))[1],
      // so the user id MUST be the first path segment — a "gallery/" prefix in
      // front of it made every upload fail the WITH CHECK and 403.
      const path = `${session.user.id}/gallery/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);

      const { data: row, error: insErr } = await (supabase as any).from("vault_media").insert({
        user_id: session.user.id,
        file_name: file.name,
        file_type: file.type,
        file_url: pub.publicUrl,
        description: "",
        tags: ["uploaded"],
      }).select("id, created_at").single();
      if (insErr) throw insErr;

      const type: MediaItem["type"] = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image";
      setItems(prev => [{
        id: `vault-${row.id}`,
        source: "vault",
        raw_id: row.id,
        type,
        url: pub.publicUrl,
        title: file.name,
        provider: "uploaded",
        created_at: row.created_at,
      }, ...prev]);
    } catch (err: any) {
      toast.error("Upload failed", { description: err?.message ?? "unknown error" });
    } finally {
      setUploading(false);
    }
  }, []);




  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const uid = session.user.id;

      // Load from vault_media (file uploads + generated assets)
      // Load from vault_media (file uploads + generated assets)
      const { data: vaultData, error: vaultErr } = await (supabase as any)
        .from("vault_media")
        .select("id, file_name, file_type, file_url, description, tags, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(200);

      if (vaultErr) console.warn("[Gallery] vault_media error:", vaultErr.message);

      // Load social posts (generated images for social media)
      const { data: socialData, error: socialErr } = await (supabase as any)
        .from("mavis_social_posts")
        .select("id, platform, content, media_urls, created_at")
        .eq("user_id", uid)
        .not("media_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);

      if (socialErr) console.warn("[Gallery] social_posts error:", socialErr.message);

      const collected: MediaItem[] = [];

      // Process vault_media
      for (const item of (vaultData ?? [])) {
        const fileUrl = item.file_url ?? "";
        if (!fileUrl) continue;

        const type = classify(item.file_type ?? "", fileUrl);
        if (!type) continue;

        collected.push({
          id: `vault-${item.id}`,
          source: "vault",
          raw_id: item.id,
          type,
          url: fileUrl,
          title: item.file_name ?? "untitled",
          description: item.description ?? "",
          tags: Array.isArray(item.tags) ? item.tags : [],
          created_at: item.created_at,
        });
      }

      // Process social posts with media
      for (const post of (socialData ?? [])) {
        const urls: string[] = Array.isArray(post.media_urls) ? post.media_urls : [];
        for (const url of urls) {
          if (!url) continue;
          collected.push({
            id: `social-${post.id}-${url}`,
            source: "social",
            type: classify("", url) ?? "image",
            url,
            title: post.content?.slice(0, 60) ?? `${post.platform} post`,
            provider: post.platform,
            created_at: post.created_at,
          });
        }
      }

      // Sort by date descending
      collected.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setItems(await repairVaultUrls(collected));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = filter === "all" ? items : items.filter((i) => i.type === filter);

  const counts: Record<FilterType, number> = {
    all:    items.length,
    image:  items.filter((i) => i.type === "image").length,
    audio:  items.filter((i) => i.type === "audio").length,
    video:  items.filter((i) => i.type === "video").length,
    poster: items.filter((i) => i.type === "poster").length,
  };

  const prependItem = useCallback((item: MediaItem) => {
    setItems(prev => [item, ...prev]);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Creative Studio"
        subtitle="Generate cinematic images and video — inspired by Higgsfield"
        icon={<Wand2 size={18} />}
        actions={
          <div className="flex items-center gap-3">
            <label className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 cursor-pointer">
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {uploading ? "Uploading…" : "Upload"}
              <input type="file" accept="image/*,video/*" onChange={handleUpload} disabled={uploading} className="hidden" />
            </label>
            <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        }
      />

      {/* Mode switcher — Image | Video */}
      <div className="flex gap-1 bg-muted/20 border border-border rounded-lg p-1 self-start">
        <button
          onClick={() => setGenMode("image")}
          className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-md transition-colors ${
            genMode === "image" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Image size={12} /> Image
        </button>
        <button
          onClick={() => setGenMode("video")}
          className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-md transition-colors ${
            genMode === "video" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Film size={12} /> Video
        </button>
      </div>

      {genMode === "image"
        ? <ImageGenPanel onGenerated={prependItem} onPreview={(url) => setPreviewItem({ url, type: "image" })} />
        : <VideoGenPanel onGenerated={prependItem} seedImageUrl={seedImageUrl} onPreview={(url) => setPreviewItem({ url, type: "video" })} />}



      {/* Filter bar */}
      <div className="flex gap-1 border-b border-border pb-0">
        {(["all", "image", "audio", "video", "poster"] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-mono border-b-2 capitalize transition-colors ${
              filter === f ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {FILTER_ICONS[f]} {f}
            {counts[f] > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] ${
                filter === f ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground"
              }`}>
                {counts[f]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading gallery…" size="lg" />
      ) : visible.length === 0 ? (

        <div className="text-center py-16">
          <p className="text-xs font-mono text-muted-foreground">No {filter === "all" ? "assets" : filter} found.</p>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            Generated images, audio, video, and posters will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <AnimatePresence>
            {visible.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                onSendToVideo={handleSendToVideo}
                onDelete={item.source === "vault" ? handleDelete : undefined}
                onEdit={item.source === "vault" ? setEditItem : undefined}
                onPreview={(i) => setPreviewItem({ url: i.url, type: i.type === "video" ? "video" : "image", title: i.title })}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <Lightbox item={previewItem} onClose={() => setPreviewItem(null)} />
      <EditSheet item={editItem} onClose={() => setEditItem(null)} onSaved={handleEditSaved} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {pendingDelete?.type}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.title ? `"${pendingDelete.title}" ` : ""}will be removed from your vault, along with its
              stored file. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

