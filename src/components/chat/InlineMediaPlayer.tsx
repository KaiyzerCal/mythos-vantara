import { useState, useRef } from "react";
import { Play, Pause, Volume2, Maximize2, X, Loader2 } from "lucide-react";

// Detects media URLs embedded in message content and renders inline players.
// Supports: audio (mp3/wav/ogg/m4a), video (mp4/webm), HTML poster previews.

const AUDIO_RE = /https?:\/\/[^\s<>"'\]()]+\.(?:mp3|wav|ogg|m4a|flac|aac)(?:[?#][^\s<>"'\]()]*)?/gi;
const VIDEO_RE = /https?:\/\/[^\s<>"'\]()]+\.(?:mp4|webm|mov)(?:[?#][^\s<>"'\]()]*)?/gi;
const HTML_RE  = /https?:\/\/[^\s<>"'\]()]+\.html(?:[?#][^\s<>"'\]()]*)?/gi;

// Labeled URL patterns emitted by our skill outputs
const AUDIO_LABEL_RE = /(?:\*{0,2}Audio URL:?\*{0,2})\s*(https?:\/\/[^\s<>"'\]()]+)/gi;
const HTML_LABEL_RE  = /(?:\*{0,2}HTML URL:?\*{0,2})\s*(https?:\/\/[^\s<>"'\]()]+)/gi;
const VIDEO_LABEL_RE = /(?:\*{0,2}Video URL:?\*{0,2})\s*(https?:\/\/[^\s<>"'\]()]+)/gi;

export function extractMediaFromText(text: string) {
  const audioUrls = new Set<string>();
  const videoUrls = new Set<string>();
  const htmlUrls  = new Set<string>();

  // Labeled first (highest specificity)
  for (const m of text.matchAll(AUDIO_LABEL_RE)) audioUrls.add(m[1]);
  for (const m of text.matchAll(HTML_LABEL_RE))  htmlUrls.add(m[1]);
  for (const m of text.matchAll(VIDEO_LABEL_RE)) videoUrls.add(m[1]);

  // Extension-based fallback
  for (const m of text.matchAll(AUDIO_RE)) audioUrls.add(m[0]);
  for (const m of text.matchAll(VIDEO_RE)) videoUrls.add(m[0]);
  for (const m of text.matchAll(HTML_RE))  htmlUrls.add(m[0]);

  return { audio: [...audioUrls], video: [...videoUrls], html: [...htmlUrls] };
}

// ── Audio Player ─────────────────────────────────────────────────────────────

function AudioPlayer({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else         { el.play(); setPlaying(true); }
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const fileName = url.split("/").pop()?.split("?")[0] ?? "audio";

  return (
    <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 max-w-xs">
      <audio
        ref={ref}
        src={url}
        onTimeUpdate={() => setProgress(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(ref.current?.duration ?? 0)}
        onEnded={() => setPlaying(false)}
      />
      <button
        onClick={toggle}
        className="w-7 h-7 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/25 transition-colors shrink-0"
      >
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono text-foreground/70 truncate mb-1">{fileName}</p>
        <div
          className="h-1 rounded-full bg-muted overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const el = ref.current;
            if (el) { el.currentTime = pct * (el.duration || 0); }
          }}
        >
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }}
          />
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[10px] font-mono text-muted-foreground">{fmt(progress)}</span>
          <span className="text-[10px] font-mono text-muted-foreground">{fmt(duration)}</span>
        </div>
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
        title="Open in new tab"
      >
        <Volume2 size={12} />
      </a>
    </div>
  );
}

// ── Video Player ─────────────────────────────────────────────────────────────

function VideoPlayer({ url }: { url: string }) {
  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-primary/20 max-w-sm">
      <video
        src={url}
        controls
        className="w-full max-h-[280px] bg-black"
        preload="metadata"
      />
    </div>
  );
}

// ── HTML Poster Preview ───────────────────────────────────────────────────────

function PosterPreview({ url }: { url: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-primary/70 flex items-center gap-1">
          <Maximize2 size={10} /> HTML Poster Preview
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      <div
        className="relative rounded-lg overflow-hidden border border-primary/20 bg-muted/20 transition-all"
        style={{ height: expanded ? 480 : 220 }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={16} className="animate-spin text-primary/50" />
          </div>
        )}
        <iframe
          src={url}
          sandbox="allow-scripts allow-same-origin"
          className="w-full h-full border-0"
          title="Poster preview"
          onLoad={() => setLoading(false)}
        />
      </div>

      <div className="flex items-center gap-2 mt-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono text-primary/70 hover:text-primary transition-colors underline"
        >
          Open full size
        </a>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface InlineMediaPlayerProps {
  content: string;
  imageUrl?: string; // already rendered — skip image detection
}

export function InlineMediaPlayer({ content, imageUrl: _imageUrl }: InlineMediaPlayerProps) {
  const { audio, video, html } = extractMediaFromText(content);

  if (!audio.length && !video.length && !html.length) return null;

  return (
    <div className="flex flex-col gap-1">
      {audio.map((url) => <AudioPlayer key={url} url={url} />)}
      {video.map((url) => <VideoPlayer key={url} url={url} />)}
      {html.map((url)  => <PosterPreview key={url} url={url} />)}
    </div>
  );
}
