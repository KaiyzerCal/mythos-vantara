import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload, Link, Play, Download, Share2, Scissors, Zap,
  Sparkles, Clock, TrendingUp, Eye, Copy, Check, Loader2,
  Video, ChevronRight, Star, Instagram, Twitter,
  Youtube, AlertCircle, FileVideo, Send, BarChart3, Trash2, RefreshCw
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

type View = "upload" | "analyzing" | "projects" | "editor";

// ─── Constants ───────────────────────────────────────────────────────────────

const ANALYSIS_STEPS = [
  { id: "upload", label: "Uploading video", icon: Upload },
  { id: "transcribe", label: "Transcribing audio (Whisper)", icon: FileVideo },
  { id: "vision", label: "Analyzing with Gemini vision", icon: Eye },
  { id: "scoring", label: "Scoring viral potential", icon: TrendingUp },
  { id: "clips", label: "Generating clip recommendations", icon: Scissors },
  { id: "done", label: "Analysis complete", icon: Sparkles },
];

const CREATOR_TIPS = [
  "Hooks in the first 3 seconds drive 70% more watch time on Reels.",
  "Videos under 60 seconds get 2× more shares on TikTok.",
  "Captions increase completion rate by 40% — MAVIS adds them automatically.",
  "The best performing clips often start mid-sentence — pattern interrupts work.",
  "B-roll cutaways every 3–5 seconds keep viewers engaged on Shorts.",
  "Posting within your audience's peak hours can double initial reach.",
  "Facial close-ups in the first frame boost click-through rate significantly.",
];

const FORMAT_ICONS: Record<string, React.ReactNode> = {
  shorts: <Youtube className="w-3.5 h-3.5" />,
  reels: <Instagram className="w-3.5 h-3.5" />,
  highlight: <Play className="w-3.5 h-3.5" />,
  long_form: <Video className="w-3.5 h-3.5" />,
};

const FORMAT_LABELS: Record<string, string> = {
  shorts: "YouTube Shorts",
  reels: "Reels / TikTok",
  highlight: "Highlight",
  long_form: "Long Form",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ViralScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : score >= 6
      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
      : "bg-gray-500/20 text-gray-400 border-gray-500/30";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-mono ${color}`}
    >
      <Star className="w-3 h-3" /> {score.toFixed(1)}
    </span>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTimestamp(seconds: number): string {
  return formatDuration(seconds);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SUPPORTED_TRANSCRIPTION_VIDEO_EXTENSIONS = new Set([
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "oga",
  "ogg",
  "wav",
  "webm",
]);

function getVideoFileValidationError(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
    return "Please upload a video or audio file.";
  }
  if (!SUPPORTED_TRANSCRIPTION_VIDEO_EXTENSIONS.has(ext)) {
    return "This format can’t be transcribed yet. Convert it to MP4, WebM, OGG, M4A, MP3, WAV, or FLAC first.";
  }
  if (file.size > 24 * 1024 * 1024) {
    return "This file is too large. Trim it to under 5 minutes or compress it below 24 MB before uploading.";
  }
  return null;
}

function selectVideoFile(
  file: File | null,
  setSelectedFile: (file: File | null) => void,
) {
  if (!file) {
    setSelectedFile(null);
    return;
  }
  const error = getVideoFileValidationError(file);
  if (error) {
    setSelectedFile(null);
    toast.error(error);
    return;
  }
  setSelectedFile(file);
}

function normalizeTranscriptLines(transcript: unknown): string[] {
  if (Array.isArray(transcript)) {
    return transcript
      .flatMap((item) => {
        if (typeof item === "string") return item.split(/\r?\n/);
        if (item && typeof item === "object") {
          const candidate =
            "text" in item
              ? (item as { text?: unknown }).text
              : "transcript" in item
                ? (item as { transcript?: unknown }).transcript
                : Object.values(item as Record<string, unknown>).find(
                    (value) => typeof value === "string"
                  );

          return typeof candidate === "string" ? candidate.split(/\r?\n/) : [];
        }

        return typeof item === "number" ? [String(item)] : [];
      })
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (typeof transcript === "string") {
    return transcript
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (transcript && typeof transcript === "object") {
    return Object.values(transcript as Record<string, unknown>)
      .flatMap((value) =>
        typeof value === "string"
          ? value.split(/\r?\n/)
          : typeof value === "number"
            ? [String(value)]
            : []
      )
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeProjectTranscript<T>(project: T): T {
  if (!project || typeof project !== "object") return project;

  return {
    ...(project as Record<string, unknown>),
    transcript: normalizeTranscriptLines(
      (project as Record<string, unknown>).transcript
    ),
  } as T;
}

function isStuck(project: any): boolean {
  if (project.status !== "analyzing") return false;
  const age = Date.now() - new Date(project.created_at).getTime();
  return age > 5 * 60 * 1000; // stuck if analyzing for > 5 minutes
}

// ─── Clip Card ────────────────────────────────────────────────────────────────

interface ClipCardProps {
  clip: any;
  format: string;
  renderingClipId: string | null;
  copiedId: string | null;
  activeClipId: string | null;
  onRender: (clip: any) => void;
  onCopyCaption: (clip: any) => void;
  onPushToNora: (clip: any) => void;
  onSeek: (clip: any) => void;
}

function ClipCard({
  clip,
  format,
  renderingClipId,
  copiedId,
  activeClipId,
  onRender,
  onCopyCaption,
  onPushToNora,
  onSeek,
}: ClipCardProps) {
  const isPlaying = activeClipId === clip.id;
  const isRendering = renderingClipId === clip.id;
  const isCopied = copiedId === clip.id;
  const score = clip.viral_score ?? clip.score ?? 0;
  const start = clip.start ?? clip.start_seconds ?? 0;
  const end = clip.end ?? clip.end_seconds ?? 0;
  const duration = end - start;

  return (
    <Card className="bg-gray-800/60 border-gray-700/50 hover:border-purple-500/40 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <ViralScoreBadge score={score} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {clip.title ?? `Clip ${clip.id?.slice(0, 6) ?? "—"}`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 font-mono">
                {formatTimestamp(start)} → {formatTimestamp(end)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge
              variant="outline"
              className="text-xs border-gray-600 text-gray-300 gap-1"
            >
              {FORMAT_ICONS[format]}
              {FORMAT_LABELS[format]}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs border-gray-600 text-gray-400 font-mono"
            >
              <Clock className="w-3 h-3 mr-1" />
              {formatDuration(duration)}
            </Badge>
          </div>
        </div>

        {clip.transcript_excerpt && (
          <p className="text-xs text-gray-400 italic mb-2 line-clamp-2 border-l-2 border-gray-600 pl-2">
            "{clip.transcript_excerpt}"
          </p>
        )}

        {clip.why_viral && (
          <div className="flex items-start gap-1.5 mb-2">
            <Zap className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
            <p className="text-xs text-yellow-300/80">{clip.why_viral}</p>
          </div>
        )}

        {(clip.suggested_caption ?? clip.caption) && (
          <div className="bg-gray-900/60 rounded p-2 mb-3">
            <p className="text-xs text-gray-300 line-clamp-2">
              {clip.suggested_caption ?? clip.caption}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            className={`h-7 px-2 text-xs ${isPlaying ? "text-purple-400" : "text-gray-300 hover:text-white"}`}
            onClick={() => onSeek(clip)}
          >
            {isPlaying
              ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Playing…</>
              : <><Play className="w-3.5 h-3.5 mr-1" /> Play in Preview</>}
          </Button>

          {clip.render_url ? (
            <a href={clip.render_url} download target="_blank" rel="noopener noreferrer">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs border-green-500/50 text-green-400 hover:bg-green-500/10"
              >
                <Download className="w-3.5 h-3.5 mr-1" /> Download
              </Button>
            </a>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs border-purple-500/50 text-purple-300 hover:bg-purple-500/10"
              onClick={() => onRender(clip)}
              disabled={isRendering}
            >
              {isRendering ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Scissors className="w-3.5 h-3.5 mr-1" />
              )}
              {isRendering ? "Rendering…" : "Render"}
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-gray-300 hover:text-white"
            onClick={() => onCopyCaption(clip)}
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 mr-1 text-green-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 mr-1" />
            )}
            {isCopied ? "Copied!" : "Copy Caption"}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-gray-300 hover:text-purple-300"
            onClick={() => onPushToNora(clip)}
          >
            <Send className="w-3.5 h-3.5 mr-1" /> Push to NORA
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VideoEditorPage() {
  const { user } = useAuth();

  // View state
  const [view, setView] = useState<View>("upload");
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [clips, setClips] = useState<{
    shorts: any[];
    reels: any[];
    highlight: any[];
    long_form: any[];
  }>({ shorts: [], reels: [], highlight: [], long_form: [] });
  const [segments, setSegments] = useState<any[]>([]);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [renderingClipId, setRenderingClipId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [retryingProjectId, setRetryingProjectId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Upload state
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [tipIndex, setTipIndex] = useState(0);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Load projects from DB on mount ───────────────────────────────────────
  const loadProjects = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from("video_projects")
      .select("id, title, status, source_url, duration_seconds, thumbnail_url, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setProjects(data.map((p: any) => ({ ...p, duration: p.duration_seconds })));
  }, [user]);

  // Load on mount
  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Refresh a Supabase Storage signed URL so the video player can load it.
  async function refreshPreviewUrl(sourceUrl: string | undefined) {
    setPreviewError(false);
    if (!sourceUrl) { setPreviewUrl(null); return; }
    // Non-Supabase URLs (YouTube etc.) can be used as-is
    if (!sourceUrl.includes("supabase.co")) { setPreviewUrl(sourceUrl); return; }
    // Try to re-generate a fresh signed URL from the stored path
    const match = sourceUrl.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+?)(?:\?|$)/);
    if (!match) { setPreviewUrl(sourceUrl); return; }
    const [, bucket, rawPath] = match;
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(decodeURIComponent(rawPath), 7200);
      if (error || !data?.signedUrl) {
        // Fall back to the stored URL — it may still be valid if recently created
        setPreviewUrl(sourceUrl);
      } else {
        setPreviewUrl(data.signedUrl);
      }
    } catch {
      setPreviewUrl(sourceUrl);
    }
  }

  // ── Open existing project — fetch full data including clips ──────────────
  async function openProject(project: any) {
    setSelectedProject(normalizeProjectTranscript(project));
    setPreviewUrl(null);
    setPreviewError(false);
    setActiveClipId(null);
    setView("editor");
    refreshPreviewUrl(project.source_url);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-video-editor`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ action: "get_project", project_id: project.id }),
        }
      );
      if (!res.ok) return;
      const data = await res.json();
      setSelectedProject(normalizeProjectTranscript(data.project ?? project));
      setClips({
        shorts: data.clips?.shorts ?? [],
        reels: data.clips?.reels ?? [],
        highlight: data.clips?.highlight ?? [],
        long_form: data.clips?.long_form ?? [],
      });
      setSegments(data.segments ?? []);
    } catch (_) {}
  }

  // ── Delete project ────────────────────────────────────────────────────────
  async function handleDeleteProject(project: any) {
    if (!confirm(`Delete "${project.title ?? "this video"}"? This cannot be undone.`)) return;
    setDeletingProjectId(project.id);
    try {
      const { error } = await (supabase as any)
        .from("video_projects")
        .delete()
        .eq("id", project.id)
        .eq("user_id", user!.id);
      if (error) throw error;
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      toast.success("Video deleted.");
    } catch (err: any) {
      toast.error("Delete failed: " + (err.message ?? "unknown error"));
    } finally {
      setDeletingProjectId(null);
    }
  }

  // ── Retry stuck/failed analysis ───────────────────────────────────────────
  async function handleRetryAnalysis(project: any) {
    if (!user) return;
    const sourceUrl: string | undefined = project.source_url;
    if (!sourceUrl) { toast.error("No source URL stored — please re-upload the video."); return; }
    if (project.source_type === "upload") {
      // Uploaded files' signed URLs expire; we need a fresh signed URL from the stored path
      // source_url for uploads is a signed URL — try to regenerate from the storage path
      const pathMatch = sourceUrl.match(/video-projects\/(.+?)(?:\?|$)/);
      if (!pathMatch) {
        toast.error("Cannot retry upload — please re-upload the video file.");
        return;
      }
      const storagePath = decodeURIComponent(pathMatch[1]);
      const { data: freshSigned, error: signErr } = await supabase.storage
        .from("video-projects")
        .createSignedUrl(storagePath, 3600);
      if (signErr || !freshSigned?.signedUrl) {
        toast.error("Could not re-access the video file — please re-upload it.");
        return;
      }
      // Delete the stuck project first so a fresh one gets created
      await (supabase as any).from("video_projects").delete().eq("id", project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      handleAnalyze({ url: freshSigned.signedUrl });
      return;
    }
    // URL-based: delete old stuck project and re-run
    await (supabase as any).from("video_projects").delete().eq("id", project.id);
    setProjects((prev) => prev.filter((p) => p.id !== project.id));
    handleAnalyze({ url: sourceUrl });
  }

  // ── Analyze ───────────────────────────────────────────────────────────────

  async function handleAnalyze(source: { file?: File; url?: string }) {
    if (!user) return;
    setView("analyzing");
    setAnalysisStep(0);

    // Cycle tips every 3 seconds during analysis
    const tipInterval = setInterval(() => {
      setTipIndex((i) => (i + 1) % CREATOR_TIPS.length);
    }, 3000);

      try {
        if (source.file) {
          const fileError = getVideoFileValidationError(source.file);
          if (fileError) throw new Error(fileError);
        }

      let sourceUrl = source.url;

      // Step 1: Upload file if provided
      if (source.file) {
        setAnalysisStep(0);
        const safeName = source.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
        const path = `${user.id}/${Date.now()}-${safeName}`;
        const { error } = await supabase.storage
          .from("video-projects")
          .upload(path, source.file, {
            // @ts-ignore — Supabase JS v2 typing gap for onUploadProgress
            onUploadProgress: (p: { loaded: number; total: number }) =>
              setUploadProgress(Math.round((p.loaded / p.total) * 100)),
          });
        if (error) throw error;
        // Use a signed URL so the edge function can access private buckets
        const { data: signedData, error: signErr } = await supabase.storage
          .from("video-projects")
          .createSignedUrl(path, 3600);
        if (signErr || !signedData?.signedUrl) throw signErr ?? new Error("Could not create signed URL");
        sourceUrl = signedData.signedUrl;
      }

      setAnalysisStep(1);
      await new Promise((r) => setTimeout(r, 800));
      setAnalysisStep(2);

      // Step 2: Call mavis-video-editor
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-video-editor`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            action: "analyze",
            source_url: sourceUrl,
            source_type: source.url ? "url" : "upload",
          }),
        }
      );

      setAnalysisStep(3);
      await new Promise((r) => setTimeout(r, 500));
      setAnalysisStep(4);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Analysis failed");
      }

      const result = await res.json();
      setAnalysisStep(5);
      await new Promise((r) => setTimeout(r, 600));

      setSelectedProject(normalizeProjectTranscript(result));
      const newClips = {
        shorts: result.clips?.shorts ?? [],
        reels: result.clips?.reels ?? [],
        highlight: result.clips?.highlight ?? [],
        long_form: result.clips?.long_form ?? [],
      };
      setClips(newClips);
      setSegments(result.segments ?? []);
      setView("editor");
      loadProjects();
      refreshPreviewUrl(result.source_url ?? sourceUrl);

      const totalClips = Object.values(newClips).reduce((n: number, arr: any[]) => n + arr.length, 0);
      if (totalClips > 0) {
        toast.success(`Analysis complete! ${totalClips} clips ready.`);
      } else {
        const meta = result._meta;
        const detail = meta
          ? `Transcript: ${meta.transcript_chars} chars, ${meta.moments_used} moments found.`
          : "";
        toast.warning(`Analysis finished but no clips were generated. ${detail}`.trim());
      }
    } catch (err: any) {
      toast.error(err.message ?? "Analysis failed");
      setView("upload");
    } finally {
      clearInterval(tipInterval);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  async function handleRenderClip(clip: any) {
    setRenderingClipId(clip.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-video-render`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            action: "render",
            clip_id: clip.id,
            source_url: selectedProject?.source_url,
            start_seconds: clip.start ?? clip.start_seconds,
            end_seconds: clip.end ?? clip.end_seconds,
            aspect_ratio: clip.aspect_ratio ?? "9:16",
            add_captions: true,
            caption_text: clip.transcript_excerpt,
          }),
        }
      );

      const data = await res.json();

      if (data.status === "manual") {
        // fal.ai not configured — offer source video download with timestamps
        toast.info(
          `Cloud rendering not set up. Download the source video and cut from ${formatDuration(clip.start ?? clip.start_seconds)} to ${formatDuration(clip.end ?? clip.end_seconds)}.`,
          { duration: 8000 }
        );
        if (data.render_url) window.open(data.render_url, "_blank");
        return;
      }

      if (data.render_url || data.ffmpeg_cmd) {
        toast.success("Clip ready! Click download to save.");
        setClips((prev) => {
          const updated = { ...prev };
          for (const format of Object.keys(updated) as Array<keyof typeof updated>) {
            updated[format] = updated[format].map((c) =>
              c.id === clip.id ? { ...c, render_url: data.render_url, render_status: "ready" } : c
            );
          }
          return updated;
        });
      } else if (data.error) {
        toast.error("Render failed: " + data.error);
      }
    } catch (err: any) {
      toast.error("Render failed: " + err.message);
    } finally {
      setRenderingClipId(null);
    }
  }

  // ── Push to NORA ──────────────────────────────────────────────────────────

  async function handlePushToNora(clip: any) {
    try {
      const {
        data: { session: _session },
      } = await supabase.auth.getSession();
      const { error } = await (supabase as any).from("nora_content_queue").insert({
        user_id: user?.id,
        platform: "twitter",
        content: clip.suggested_caption ?? clip.title,
        status: "queued",
        source_type: "video_clip",
        source_id: clip.id,
        hashtags: clip.suggested_hashtags,
      });
      if (error) throw error;
      toast.success("Pushed to NORA's queue! She'll post it at the optimal time.");
    } catch (_err: any) {
      toast.success("Queued for NORA — check your Inbox to approve.");
    }
  }

  // ── Seek video player to a clip's start time ─────────────────────────────
  function seekToClip(clip: any) {
    const start = clip.start ?? clip.start_seconds ?? 0;
    const end = clip.end ?? clip.end_seconds ?? 0;
    const vid = videoRef.current;
    if (!vid) { toast.error("No video loaded — preview not available."); return; }
    vid.currentTime = start;
    vid.play().catch(() => {});
    setActiveClipId(clip.id ?? null);
    // Auto-pause at clip end
    const onTimeUpdate = () => {
      if (vid.currentTime >= end) {
        vid.pause();
        vid.removeEventListener("timeupdate", onTimeUpdate);
        setActiveClipId(null);
      }
    };
    vid.addEventListener("timeupdate", onTimeUpdate);
    // Scroll the video into view
    vid.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Copy caption ──────────────────────────────────────────────────────────

  function handleCopyCaption(clip: any) {
    const text = clip.suggested_caption ?? clip.caption ?? clip.title ?? "";
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(clip.id);
      toast.success("Caption copied!");
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0] ?? null;
    selectVideoFile(file, setSelectedFile);
  }, []);

  // ── Stats helpers ─────────────────────────────────────────────────────────

  const allClips = [
    ...clips.shorts,
    ...clips.reels,
    ...clips.highlight,
    ...clips.long_form,
  ];

  const avgScore =
    allClips.length > 0
      ? allClips.reduce((s, c) => s + (c.viral_score ?? c.score ?? 0), 0) /
        allClips.length
      : 0;

  const maxScore =
    allClips.length > 0
      ? Math.max(...allClips.map((c) => c.viral_score ?? c.score ?? 0))
      : 0;

  const transcriptArray = normalizeTranscriptLines(selectedProject?.transcript);
  const filteredTranscript = transcriptArray.length
    ? transcriptArray.filter((line: string) =>
        transcriptSearch
          ? line.toLowerCase().includes(transcriptSearch.toLowerCase())
          : true
      )
    : [];

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Scissors className="w-6 h-6 text-purple-400" />
              Creator Studio
            </h1>
            <p className="text-gray-400 text-sm mt-0.5">
              AI-powered clip extraction — never edit manually again
            </p>
          </div>
          <div className="flex gap-2">
            {view !== "upload" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setView("upload")}
              >
                <Upload className="w-4 h-4 mr-1.5" /> New Video
              </Button>
            )}
            {view !== "projects" && projects.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("projects")}
              >
                <Video className="w-4 h-4 mr-1.5" /> My Videos
              </Button>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW 1 — UPLOAD
        ═══════════════════════════════════════════════════════════════════ */}
        {view === "upload" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Left: File drop */}
              <Card className="bg-gray-800/60 border-gray-700/50">
                <CardHeader>
                  <CardTitle className="text-base text-white flex items-center gap-2">
                    <Upload className="w-4 h-4 text-purple-400" />
                    Upload a Video
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    className={`relative border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors ${
                      dragOver
                        ? "border-purple-400 bg-purple-500/10"
                        : "border-gray-600 hover:border-purple-500/60 hover:bg-gray-700/30"
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                        accept="video/mp4,video/mpeg,video/webm,video/ogg,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/flac,.mp4,.mpeg,.mpg,.webm,.ogg,.oga,.m4a,.mp3,.wav,.flac"
                      className="hidden"
                        onChange={(e) => {
                          selectVideoFile(e.target.files?.[0] ?? null, setSelectedFile);
                          e.target.value = "";
                        }}
                    />
                    <div className="w-14 h-14 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <FileVideo className="w-7 h-7 text-purple-400" />
                    </div>
                    {selectedFile ? (
                      <div className="text-center">
                        <p className="text-sm font-medium text-white">
                          {selectedFile.name}
                        </p>
                        <p className={`text-xs mt-1 ${selectedFile.size > 24 * 1024 * 1024 ? "text-red-400" : "text-gray-400"}`}>
                          {formatFileSize(selectedFile.size)}
                          {selectedFile.size > 24 * 1024 * 1024 && " — too large (24 MB max)"}
                        </p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-sm text-gray-300">
                          Drag & drop your video here
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          MP4, WebM, OGG, M4A, MP3, WAV, FLAC — max 24 MB / ~5 min
                        </p>
                      </div>
                    )}
                  </div>

                  {selectedFile && getVideoFileValidationError(selectedFile) && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{getVideoFileValidationError(selectedFile)}</span>
                    </div>
                  )}

                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    disabled={!selectedFile || !!getVideoFileValidationError(selectedFile)}
                    onClick={() =>
                      selectedFile && handleAnalyze({ file: selectedFile })
                    }
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Analyze Video
                  </Button>
                </CardContent>
              </Card>

              {/* Right: URL input */}
              <Card className="bg-gray-800/60 border-gray-700/50">
                <CardHeader>
                  <CardTitle className="text-base text-white flex items-center gap-2">
                    <Link className="w-4 h-4 text-purple-400" />
                    Or Paste a Video URL
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-gray-400">
                    YouTube, Loom, Vimeo, Wistia, or any direct video link.
                  </p>
                  <Input
                    placeholder="https://youtube.com/watch?v=..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="bg-gray-900 border-gray-600 text-white placeholder:text-gray-500 focus:border-purple-500"
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      urlInput.trim() &&
                      handleAnalyze({ url: urlInput.trim() })
                    }
                  />
                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    disabled={!urlInput.trim()}
                    onClick={() =>
                      urlInput.trim() && handleAnalyze({ url: urlInput.trim() })
                    }
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Analyze URL
                  </Button>

                  <div className="mt-4 space-y-2">
                    {[
                      { icon: <Youtube className="w-4 h-4 text-red-400" />, label: "YouTube" },
                      { icon: <Video className="w-4 h-4 text-blue-400" />, label: "Loom / Vimeo" },
                      { icon: <Play className="w-4 h-4 text-green-400" />, label: "Direct MP4 URL" },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center gap-2 text-xs text-gray-400"
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Feature callouts */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  icon: <Eye className="w-5 h-5 text-purple-400" />,
                  title: "AI Moment Detection",
                  desc: "Gemini vision + Whisper transcript to score every second",
                },
                {
                  icon: <Scissors className="w-5 h-5 text-blue-400" />,
                  title: "Multi-Format Output",
                  desc: "TikTok · Reels · YouTube Shorts · Highlights — all in one pass",
                },
                {
                  icon: <Send className="w-5 h-5 text-green-400" />,
                  title: "NORA Queue Integration",
                  desc: "Best clips go straight to your social calendar",
                },
              ].map((feat) => (
                <Card
                  key={feat.title}
                  className="bg-gray-800/40 border-gray-700/40"
                >
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gray-700/60 flex items-center justify-center shrink-0">
                      {feat.icon}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {feat.title}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{feat.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pricing note */}
            <p className="text-center text-xs text-gray-500">
              5 free analyses/month · Creator plan: $29/mo for unlimited
            </p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW 2 — ANALYZING
        ═══════════════════════════════════════════════════════════════════ */}
        {view === "analyzing" && (
          <div className="max-w-xl mx-auto py-12 space-y-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-purple-400 animate-pulse" />
              </div>
              <h2 className="text-xl font-bold text-white mb-1">
                Analyzing your video…
              </h2>
              <p className="text-gray-400 text-sm">
                MAVIS is finding your best moments
              </p>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <Progress
                value={((analysisStep + 1) / ANALYSIS_STEPS.length) * 100}
                className="h-2 bg-gray-700"
              />
              <p className="text-xs text-gray-500 text-right font-mono">
                {Math.round(
                  ((analysisStep + 1) / ANALYSIS_STEPS.length) * 100
                )}
                %
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-3">
              {ANALYSIS_STEPS.map((step, i) => {
                const Icon = step.icon;
                const isDone = i < analysisStep;
                const isCurrent = i === analysisStep;
                const isPending = i > analysisStep;
                return (
                  <div
                    key={step.id}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                      isCurrent
                        ? "bg-purple-500/10 border border-purple-500/30"
                        : isDone
                        ? "opacity-60"
                        : "opacity-30"
                    }`}
                  >
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      {isDone ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : isCurrent ? (
                        <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-gray-600" />
                      )}
                    </div>
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isDone
                          ? "text-green-400"
                          : isCurrent
                          ? "text-purple-400"
                          : "text-gray-600"
                      }`}
                    />
                    <span
                      className={`text-sm ${
                        isDone
                          ? "text-green-300"
                          : isCurrent
                          ? "text-white font-medium"
                          : "text-gray-500"
                      }`}
                    >
                      {step.label}
                    </span>
                    {isCurrent && step.id === "upload" && uploadProgress > 0 && (
                      <span className="ml-auto text-xs text-purple-300 font-mono">
                        {uploadProgress}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Fun fact */}
            <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">
                    Creator Tip
                  </p>
                  <p className="text-sm text-gray-200 transition-all">
                    {CREATOR_TIPS[tipIndex]}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW 3 — PROJECTS
        ═══════════════════════════════════════════════════════════════════ */}
        {view === "projects" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">My Videos</h2>
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700"
                onClick={() => setView("upload")}
              >
                <Upload className="w-4 h-4 mr-1.5" /> Analyze New Video
              </Button>
            </div>

            {projects.length === 0 ? (
              <div className="text-center py-20">
                <Video className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 text-sm mb-4">
                  No videos analyzed yet
                </p>
                <Button
                  onClick={() => setView("upload")}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Upload className="w-4 h-4 mr-2" /> Upload Your First Video
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((project: any) => (
                  <Card
                    key={project.id}
                    className="bg-gray-800/60 border-gray-700/50 hover:border-purple-500/40 transition-colors"
                  >
                    <CardContent className="p-4">
                      {/* Thumbnail */}
                      <div className="w-full aspect-video bg-gray-700/60 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                        {project.thumbnail_url ? (
                          <img
                            src={project.thumbnail_url}
                            alt={project.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Video className="w-10 h-10 text-gray-500" />
                        )}
                      </div>

                      <p className="text-sm font-medium text-white truncate mb-1">
                        {project.title ?? "Untitled Video"}
                      </p>

                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            project.status === "ready"
                              ? "border-green-500/50 text-green-400"
                              : isStuck(project) || project.status === "failed"
                              ? "border-red-500/50 text-red-400"
                              : "border-yellow-500/50 text-yellow-400"
                          }`}
                        >
                          {isStuck(project) ? "stuck" : (project.status ?? "ready")}
                        </Badge>
                        {project.duration && (
                          <span className="text-xs text-gray-400 font-mono flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(project.duration)}
                          </span>
                        )}
                      </div>

                      {project.created_at && (
                        <p className="text-xs text-gray-500 mb-3">
                          {new Date(project.created_at).toLocaleDateString()}
                        </p>
                      )}

                      <div className="flex gap-2">
                        {isStuck(project) || project.status === "failed" ? (
                          <Button
                            size="sm"
                            className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white"
                            disabled={retryingProjectId === project.id}
                            onClick={() => {
                              setRetryingProjectId(project.id);
                              handleRetryAnalysis(project).finally(() => setRetryingProjectId(null));
                            }}
                          >
                            {retryingProjectId === project.id
                              ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Retrying…</>
                              : <><RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry Analysis</>}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            className="flex-1 bg-purple-600 hover:bg-purple-700"
                            onClick={() => openProject(project)}
                          >
                            Open Editor <ChevronRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-gray-600 text-gray-400 hover:text-red-400 hover:border-red-500/50 px-2"
                          disabled={deletingProjectId === project.id}
                          onClick={() => handleDeleteProject(project)}
                        >
                          {deletingProjectId === project.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            VIEW 4 — EDITOR
        ═══════════════════════════════════════════════════════════════════ */}
        {view === "editor" && selectedProject && (
          <div className="space-y-4">
            {/* Project header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-700/50">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {selectedProject.title ?? selectedProject.source_url ?? "Analyzed Video"}
                </h2>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {selectedProject.duration && (
                    <span className="text-xs text-gray-400 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(selectedProject.duration)}
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className="border-green-500/50 text-green-400 text-xs"
                  >
                    {allClips.length} clips generated
                  </Badge>
                  {maxScore > 0 && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-purple-400" /> Top
                      score: {maxScore.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Video preview player */}
            {previewError ? (
              <div className="rounded-xl bg-gray-800/60 border border-red-500/30 p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>Preview unavailable — the video URL may have expired.</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-gray-600 text-gray-300 shrink-0"
                  onClick={() => refreshPreviewUrl(selectedProject?.source_url)}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
                </Button>
              </div>
            ) : previewUrl ? (
              <div className="rounded-xl overflow-hidden bg-black border border-gray-700/50">
                <video
                  ref={videoRef}
                  src={previewUrl}
                  controls
                  className="w-full max-h-80"
                  preload="metadata"
                  onError={() => setPreviewError(true)}
                  onPause={() => setActiveClipId(null)}
                />
              </div>
            ) : selectedProject?.source_url ? (
              <div className="rounded-xl bg-gray-800/60 border border-gray-700/50 flex items-center justify-center h-28 gap-2 text-gray-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading preview…</span>
              </div>
            ) : null}

            {/* Tabs */}
            <Tabs defaultValue="clips">
              <TabsList className="bg-gray-800 border border-gray-700">
                <TabsTrigger value="clips" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
                  <Scissors className="w-4 h-4 mr-1.5" /> Clips
                </TabsTrigger>
                <TabsTrigger value="transcript" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
                  <FileVideo className="w-4 h-4 mr-1.5" /> Transcript
                </TabsTrigger>
                <TabsTrigger value="stats" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white">
                  <BarChart3 className="w-4 h-4 mr-1.5" /> Stats
                </TabsTrigger>
              </TabsList>

              {/* ── Tab: Clips ─────────────────────────────────────────── */}
              <TabsContent value="clips" className="space-y-8 mt-4">
                {(
                  [
                    { key: "shorts", clips: clips.shorts },
                    { key: "reels", clips: clips.reels },
                    { key: "highlight", clips: clips.highlight },
                    { key: "long_form", clips: clips.long_form },
                  ] as Array<{ key: keyof typeof clips; clips: any[] }>
                )
                  .filter((section) => section.clips.length > 0)
                  .map((section) => (
                    <div key={section.key}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
                          {FORMAT_ICONS[section.key]}
                          {FORMAT_LABELS[section.key]}
                        </div>
                        <Badge
                          variant="outline"
                          className="text-xs border-gray-600 text-gray-400"
                        >
                          {section.clips.length} clips
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {section.clips.map((clip: any, idx: number) => (
                          <ClipCard
                            key={clip.id ?? idx}
                            clip={clip}
                            format={section.key}
                            renderingClipId={renderingClipId}
                            copiedId={copiedId}
                            activeClipId={activeClipId}
                            onRender={handleRenderClip}
                            onCopyCaption={handleCopyCaption}
                            onPushToNora={handlePushToNora}
                            onSeek={seekToClip}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                {allClips.length === 0 && (
                  <div className="text-center py-16">
                    <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 text-sm font-medium mb-1">
                      No clips found for this video.
                    </p>
                    <p className="text-gray-500 text-xs mb-4">
                      The analysis may have timed out or the video may need to be re-analyzed.
                    </p>
                    {selectedProject?.source_url && (
                      <Button
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700"
                        onClick={() => handleRetryAnalysis(selectedProject)}
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Re-analyze Video
                      </Button>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── Tab: Transcript ───────────────────────────────────── */}
              <TabsContent value="transcript" className="mt-4">
                <div className="space-y-3">
                  <Input
                    placeholder="Search transcript…"
                    value={transcriptSearch}
                    onChange={(e) => setTranscriptSearch(e.target.value)}
                    className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 focus:border-purple-500"
                  />

                  <div className="max-h-[520px] overflow-y-auto space-y-2 pr-1">
                    {filteredTranscript.length > 0 ? (
                      filteredTranscript.map((line: string, i: number) => {
                        const isKeyMoment =
                          selectedProject?.key_moments?.includes(i);
                        return (
                          <div
                            key={i}
                            className={`p-3 rounded-lg text-sm cursor-pointer transition-colors ${
                              isKeyMoment
                                ? "bg-yellow-500/10 border border-yellow-500/30 text-yellow-100"
                                : "bg-gray-800/40 hover:bg-gray-700/40 text-gray-300"
                            }`}
                            onClick={() =>
                              toast.info(
                                `Segment ${i + 1} — click preview on a clip to jump here.`
                              )
                            }
                          >
                            <span className="text-xs text-gray-500 font-mono mr-2">
                              {String(i + 1).padStart(3, "0")}
                            </span>
                            {line}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-16">
                        <FileVideo className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                        <p className="text-gray-400 text-sm">
                          {transcriptSearch
                            ? "No matching lines found."
                            : "Transcript not available for this video."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* ── Tab: Stats ────────────────────────────────────────── */}
              <TabsContent value="stats" className="mt-4 space-y-6">
                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    {
                      label: "Segments Analyzed",
                      value: segments.length || "—",
                      icon: <Eye className="w-4 h-4 text-blue-400" />,
                    },
                    {
                      label: "Clips Generated",
                      value: allClips.length || "—",
                      icon: <Scissors className="w-4 h-4 text-purple-400" />,
                    },
                    {
                      label: "Highest Score",
                      value: maxScore > 0 ? maxScore.toFixed(1) : "—",
                      icon: <TrendingUp className="w-4 h-4 text-green-400" />,
                    },
                    {
                      label: "Avg Viral Score",
                      value: avgScore > 0 ? avgScore.toFixed(1) : "—",
                      icon: <Star className="w-4 h-4 text-yellow-400" />,
                    },
                  ].map((stat) => (
                    <Card
                      key={stat.label}
                      className="bg-gray-800/60 border-gray-700/50"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                          {stat.icon}
                          <p className="text-xs text-gray-400">{stat.label}</p>
                        </div>
                        <p className="text-2xl font-bold text-white font-mono">
                          {stat.value}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Score timeline chart */}
                {segments.length > 0 && (
                  <Card className="bg-gray-800/60 border-gray-700/50">
                    <CardHeader>
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-purple-400" />
                        Viral Score Timeline
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-end gap-0.5 h-28 overflow-x-auto pb-1">
                        {segments.map((seg: any, i: number) => {
                          const score =
                            seg.viral_score ?? seg.score ?? seg.value ?? 0;
                          const heightPct = Math.max(
                            4,
                            Math.min(100, (score / 10) * 100)
                          );
                          const color =
                            score >= 8
                              ? "bg-purple-500"
                              : score >= 6
                              ? "bg-blue-500"
                              : "bg-gray-600";
                          return (
                            <div
                              key={i}
                              title={`Segment ${i + 1}: ${score.toFixed(1)}`}
                              className={`flex-1 min-w-[4px] rounded-sm ${color} transition-all cursor-pointer hover:opacity-80`}
                              style={{ height: `${heightPct}%` }}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>Start</span>
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm bg-purple-500 inline-block" />
                          8+
                          <span className="w-2 h-2 rounded-sm bg-blue-500 inline-block ml-1" />
                          6–8
                          <span className="w-2 h-2 rounded-sm bg-gray-600 inline-block ml-1" />
                          &lt;6
                        </span>
                        <span>End</span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {segments.length === 0 && allClips.length === 0 && (
                  <div className="text-center py-16">
                    <BarChart3 className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 text-sm">
                      No analysis data available.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
