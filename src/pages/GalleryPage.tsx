import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/SharedUI";
import { Loader2, Image, Music, Video, Globe, Download, ExternalLink, RefreshCw, Grid3X3, Wand2, Send, Sparkles, Film, Camera, Upload } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";


interface MediaItem {
  id: string;
  type: "image" | "audio" | "video" | "poster";
  url: string;
  title: string;
  provider?: string;
  created_at: string;
  extra?: Record<string, unknown>;
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

type FilterType = "all" | "image" | "audio" | "video" | "poster";

const FILTER_ICONS: Record<FilterType, React.ReactNode> = {
  all:    <Grid3X3 size={12} />,
  image:  <Image size={12} />,
  audio:  <Music size={12} />,
  video:  <Video size={12} />,
  poster: <Globe size={12} />,
};

function MediaCard({ item }: { item: MediaItem }) {
  const [imgError, setImgError] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="group relative rounded-lg border border-border overflow-hidden bg-card hover:border-primary/30 transition-all"
    >
      {/* Preview area */}
      <div className="relative bg-muted/20 aspect-square overflow-hidden">
        {item.type === "image" && !imgError && (
          <img
            src={item.url}
            alt={item.title}
            className="w-full h-full object-cover"
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
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            title="Open"
          >
            <ExternalLink size={13} />
          </a>
          <a
            href={item.url}
            download
            className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            title="Download"
          >
            <Download size={13} />
          </a>
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
        <p className="text-xs font-mono truncate text-foreground/80">{item.title}</p>
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

function ImageGenPanel({ onGenerated }: { onGenerated: (item: MediaItem) => void }) {
  const { session } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<typeof SIZE_OPTIONS[number]["key"]>("square");
  const [generating, setGenerating] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setLastUrl(null);
    try {
      const s = SIZE_OPTIONS.find(o => o.key === size)!;
      const { data, error } = await (supabase as any).functions.invoke("mavis-image-gen", {
        body: {
          prompt: `${prompt.trim()}. Ultra high detail, sharp focus, professional composition, cinematic lighting, 8k quality.`,
          width: s.w,
          height: s.h,
          size: `${s.w}x${s.h}`,
          quality: "high",
          aspect_ratio: s.w === s.h ? "1:1" : s.w > s.h ? "16:9" : "9:16",
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error(data?.error ?? "No image URL returned");
      setLastUrl(data.url);

      // Persist to vault_media so it shows up in the gallery on next load
      if (session?.user) {
        await (supabase as any).from("vault_media").insert({
          user_id: session.user.id,
          file_name: prompt.trim().slice(0, 80),
          file_type: "image/png",
          file_url: data.url,
          description: prompt.trim(),
          tags: ["generated", data.provider ?? "ai", `${s.w}x${s.h}`],
        });
      }

      onGenerated({
        id: `gen-${Date.now()}`,
        type: "image",
        url: data.url,
        title: prompt.trim().slice(0, 80),
        provider: data.provider ?? "ai",
        created_at: new Date().toISOString(),
        extra: { prompt, width: s.w, height: s.h },
      });
    } catch (e: any) {
      alert(`Image generation failed: ${e?.message ?? "unknown error"}\n\nEnsure an image provider key (OPENAI_API / FAL_API_KEY / GEMINI_API_KEY) is set in Supabase secrets.`);
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

      {/* Size selector */}
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

      {/* Preview of last result */}
      {lastUrl && (
        <div className="flex gap-3 items-start mt-1">
          <img src={lastUrl} alt="Generated" className="w-20 h-20 rounded-lg object-cover border border-border shrink-0" />
          <div className="flex flex-col gap-1.5 min-w-0">
            <p className="text-[10px] font-mono text-muted-foreground truncate">{prompt}</p>
            <div className="flex gap-1.5">
              <a href={lastUrl} target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-1">
                <ExternalLink size={9} /> Open
              </a>
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

function VideoGenPanel({ onGenerated }: { onGenerated: (item: MediaItem) => void }) {
  const { session } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [cameraMotion, setCameraMotion] = useState<typeof CAMERA_MOTIONS[number]["key"]>("zoom_in");
  const [aspect, setAspect] = useState<typeof VIDEO_ASPECTS[number]["key"]>("9:16");
  const [duration, setDuration] = useState<4 | 6 | 8>(4);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !session?.user) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `video-refs/${session.user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setLastUrl(null);
    try {
      const { data, error } = await (supabase as any).functions.invoke("mavis-higgsfield", {
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
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const url = data?.video_url;
      if (url) {
        setLastUrl(url);
        if (session?.user) {
          await (supabase as any).from("vault_media").insert({
            user_id: session.user.id,
            file_name: prompt.trim().slice(0, 80),
            file_type: "video/mp4",
            file_url: url,
            description: prompt.trim(),
            tags: ["generated", "higgsfield", cameraMotion, aspect, `${duration}s`],
          });
        }
        onGenerated({
          id: `vid-${Date.now()}`,
          type: "video",
          url,
          title: prompt.trim().slice(0, 80),
          provider: "higgsfield",
          created_at: new Date().toISOString(),
          extra: { cameraMotion, aspect, duration },
        });
      } else {
        alert(`Still processing — job id ${data?.video_id}. It will appear in the gallery once ready.`);
      }
    } catch (e: any) {
      alert(`Video generation failed: ${e?.message ?? "unknown error"}\n\nEnsure HIGGSFIELD_API_KEY is set in Supabase secrets.`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Film size={14} className="text-primary" />
        <span className="text-xs font-mono text-foreground font-medium">Generate Video</span>
        <span className="text-[9px] font-mono text-muted-foreground ml-auto">Higgsfield cinematic engine</span>
      </div>

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
          <video src={lastUrl} className="w-24 h-24 rounded-lg object-cover border border-border shrink-0" muted autoPlay loop playsInline />
          <div className="flex flex-col gap-1.5 min-w-0">
            <p className="text-[10px] font-mono text-muted-foreground truncate">{prompt}</p>
            <div className="flex gap-1.5">
              <a href={lastUrl} target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-1">
                <ExternalLink size={9} /> Open
              </a>
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
        const fileType: string = item.file_type ?? "";
        const publicUrl = item.file_url ?? "";
        if (!publicUrl) continue;

        let type: MediaItem["type"] = "image";
        if (fileType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/i.test(publicUrl)) type = "audio";
        else if (fileType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(publicUrl)) type = "video";
        else if (/\.html?$/i.test(publicUrl)) type = "poster";
        else if (!fileType.startsWith("image/")) continue;

        collected.push({
          id: `vault-${item.id}`,
          type,
          url: publicUrl,
          title: item.file_name ?? "untitled",
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
            type: /\.(mp4|webm|mov)$/i.test(url) ? "video" : "image",
            url,
            title: post.content?.slice(0, 60) ?? `${post.platform} post`,
            provider: post.platform,
            created_at: post.created_at,
          });
        }
      }

      // Sort by date descending
      collected.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setItems(collected);
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
          <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
            <RefreshCw size={12} /> Refresh
          </button>
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
        ? <ImageGenPanel onGenerated={prependItem} />
        : <VideoGenPanel onGenerated={prependItem} />}


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
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-primary/50" />
        </div>
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
              <MediaCard key={item.id} item={item} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
