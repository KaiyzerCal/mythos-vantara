import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/SharedUI";
import { Loader2, Image, Music, Video, Globe, Download, ExternalLink, RefreshCw, Grid3X3 } from "lucide-react";
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

export function GalleryPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const uid = session.user.id;

      // Load from vault_media (file uploads + generated assets)
      const { data: vaultData, error: vaultErr } = await (supabase as any)
        .from("vault_media")
        .select("id, file_name, file_type, storage_path, created_at, metadata")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(200);

      if (vaultErr) console.warn("[Gallery] vault_media error:", vaultErr.message);

      // Load social posts (generated images for social media)
      const { data: socialData, error: socialErr } = await (supabase as any)
        .from("mavis_social_posts")
        .select("id, platform, content, image_url, created_at, provider")
        .eq("user_id", uid)
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);

      if (socialErr) console.warn("[Gallery] social_posts error:", socialErr.message);

      const collected: MediaItem[] = [];

      // Process vault_media
      for (const item of (vaultData ?? [])) {
        const fileType: string = item.file_type ?? "";
        const meta = item.metadata ?? {};
        const publicUrl = meta.publicUrl ?? meta.url ?? item.storage_path ?? "";
        if (!publicUrl) continue;

        let type: MediaItem["type"] = "image";
        if (fileType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/i.test(publicUrl)) type = "audio";
        else if (fileType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(publicUrl)) type = "video";
        else if (/\.html?$/i.test(publicUrl)) type = "poster";
        else if (!fileType.startsWith("image/")) continue; // skip non-media

        collected.push({
          id: `vault-${item.id}`,
          type,
          url: publicUrl,
          title: item.file_name ?? "untitled",
          provider: meta.provider as string | undefined,
          created_at: item.created_at,
          extra: meta,
        });
      }

      // Process social posts with images
      for (const post of (socialData ?? [])) {
        if (!post.image_url) continue;
        collected.push({
          id: `social-${post.id}`,
          type: "image",
          url: post.image_url,
          title: post.content?.slice(0, 60) ?? `${post.platform} post`,
          provider: post.provider ?? post.platform,
          created_at: post.created_at,
        });
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Creative Gallery"
        subtitle="All AI-generated assets"
        icon={<Grid3X3 size={18} />}
        actions={
          <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
            <RefreshCw size={12} /> Refresh
          </button>
        }
      />

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
