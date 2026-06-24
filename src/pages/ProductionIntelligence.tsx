import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Upload, Film, Image, Sparkles, ChevronRight, Clock, DollarSign,
  Zap, Play, CheckCircle2, XCircle, Loader2, Eye, Trash2,
  Wand2, Video, Mic, Type, Music, Layers, Target, ArrowRight,
  Clapperboard, Bot, Palette
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const SOURCE_TOOLS = [
  { id: "heygen",     label: "HeyGen",     color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  { id: "higgsfield", label: "Higgsfield", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  { id: "canva",      label: "Canva",      color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
  { id: "runway",     label: "Runway",     color: "bg-green-500/20 text-green-300 border-green-500/30" },
  { id: "capcut",     label: "CapCut",     color: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
  { id: "other",      label: "Other",      color: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30" },
];

const MAVIS_TOOL_ROUTES: Record<string, string> = {
  "mavis-heygen-agent": "/avatar-studio",
  "mavis-avatar-video": "/avatar-studio",
  "mavis-video-gen":    "/creator",
  "mavis-video-render": "/creator",
  "mavis-video-editor": "/creator",
  "mavis-tts":          "/mavis",
  "image-generation":   "/design-studio",
};

const CONTENT_TYPE_ICONS: Record<string, typeof Film> = {
  talking_head:      Bot,
  motion_graphic:    Layers,
  cinematic_b_roll:  Film,
  social_reel:       Play,
  product_showcase:  Target,
  explainer:         Zap,
  ad_creative:       Sparkles,
  tutorial:          Eye,
  other:             Video,
};

interface MediaItem {
  id: string;
  title: string;
  media_type: "video" | "image";
  source_tool: string;
  status: "pending" | "uploading" | "analyzing" | "ready" | "error";
  error_message?: string;
  analysis?: Record<string, unknown>;
  blueprint?: Record<string, unknown>;
  created_at: string;
  preview_url?: string;
}

interface BlueprintStep {
  step: number;
  title: string;
  description: string;
  mavis_tool: string;
  mavis_action: string;
  prompt_hint?: string;
  time_estimate?: string;
  alternatives?: string[];
}

export default function ProductionIntelligence() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver]       = useState(false);
  const [sourceTool, setSourceTool]   = useState("heygen");
  const [uploading, setUploading]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [items, setItems]             = useState<MediaItem[]>([]);
  const [selected, setSelected]       = useState<MediaItem | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libLoaded, setLibLoaded]     = useState(false);

  const loadLibrary = useCallback(async () => {
    if (!user || loadingLibrary) return;
    setLoadingLibrary(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-media-analyst", {
        body: { action: "list", limit: 30 },
      });
      if (error) throw new Error(error.message);
      setItems(data?.items ?? []);
      setLibLoaded(true);
    } catch (e: any) {
      toast.error("Failed to load library: " + e.message);
    } finally {
      setLoadingLibrary(false);
    }
  }, [user, loadingLibrary]);

  if (!libLoaded && !loadingLibrary) loadLibrary();

  const handleFile = useCallback(async (file: File) => {
    if (!user) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      toast.error("Only video and image files are supported");
      return;
    }

    setUploading(true);
    setUploadProgress(10);

    try {
      const ext    = file.name.split(".").pop() ?? "mp4";
      const path   = `media-intel/${user.id}/${Date.now()}.${ext}`;
      const title  = file.name.replace(/\.[^/.]+$/, "");

      // Upload to Supabase Storage
      setUploadProgress(25);
      const { error: uploadErr } = await supabase.storage
        .from("video-projects")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadErr) throw new Error("Upload failed: " + uploadErr.message);
      setUploadProgress(55);

      // Create DB record
      const { data: rec, error: recErr } = await supabase.functions.invoke("mavis-media-analyst", {
        body: {
          action: "create_record",
          title,
          media_type: isVideo ? "video" : "image",
          mime_type:  file.type,
          file_size_bytes: file.size,
          source_tool: sourceTool,
          storage_path: path,
        },
      });
      if (recErr || !rec?.id) throw new Error("Failed to create record");
      setUploadProgress(70);

      const newItem: MediaItem = {
        id: rec.id, title, media_type: isVideo ? "video" : "image",
        source_tool: sourceTool, status: "analyzing", created_at: new Date().toISOString(),
      };
      setItems(prev => [newItem, ...prev]);
      setUploadProgress(80);
      toast.info("Analyzing with Gemini AI — this may take 30–90 seconds...");

      // Trigger analysis (long-running — runs inside edge function)
      const { data: analysis, error: analysisErr } = await supabase.functions.invoke("mavis-media-analyst", {
        body: { action: "analyze", media_id: rec.id },
      });
      setUploadProgress(100);

      if (analysisErr) throw new Error("Analysis failed: " + analysisErr.message);

      const readyItem: MediaItem = {
        ...newItem,
        status: "ready",
        analysis: analysis?.analysis,
        blueprint: analysis?.blueprint,
      };
      setItems(prev => prev.map(i => i.id === rec.id ? readyItem : i));
      setSelected(readyItem);
      toast.success("Production intelligence ready!");

    } catch (e: any) {
      toast.error(e.message);
      setItems(prev => prev.map(i => i.status === "analyzing" ? { ...i, status: "error", error_message: e.message } : i));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [user, sourceTool]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const deleteItem = async (id: string) => {
    await supabase.functions.invoke("mavis-media-analyst", { body: { action: "delete", media_id: id } });
    setItems(prev => prev.filter(i => i.id !== id));
    if (selected?.id === id) setSelected(null);
    toast.success("Deleted");
  };

  const srcTool = SOURCE_TOOLS.find(t => t.id === sourceTool);
  const analysis = selected?.analysis as any;
  const blueprint = selected?.blueprint as any;
  const ContentIcon = analysis?.content_type ? (CONTENT_TYPE_ICONS[analysis.content_type] ?? Video) : Video;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
              <Wand2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Production Intelligence</h1>
              <p className="text-sm text-muted-foreground">
                Upload content from HeyGen, Higgsfield, or Canva — MAVIS deconstructs it and builds your production blueprint
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* LEFT — Upload + Library */}
          <div className="xl:col-span-1 space-y-5">

            {/* Source tool selector */}
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Source Tool
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-3 gap-1.5">
                  {SOURCE_TOOLS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSourceTool(t.id)}
                      className={cn(
                        "text-xs font-medium px-2 py-1.5 rounded-md border transition-all",
                        sourceTool === t.id
                          ? t.color + " scale-105"
                          : "bg-muted/30 text-muted-foreground border-border/30 hover:bg-muted/60"
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Upload zone */}
            <Card
              className={cn(
                "border-2 border-dashed transition-all cursor-pointer",
                dragOver ? "border-primary bg-primary/5" : "border-border/40 hover:border-border",
                uploading && "pointer-events-none opacity-60"
              )}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
            >
              <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
                {uploading ? (
                  <>
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    <p className="text-sm font-medium">
                      {uploadProgress < 70 ? "Uploading..." : "Analyzing with Gemini AI..."}
                    </p>
                    <Progress value={uploadProgress} className="w-full h-1.5" />
                    <p className="text-xs text-muted-foreground">This can take 30–90 seconds for video</p>
                  </>
                ) : (
                  <>
                    <div className="p-3 rounded-full bg-muted/50">
                      <Upload className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Drop video or image here</p>
                      <p className="text-xs text-muted-foreground mt-1">MP4, MOV, WebM, JPG, PNG — up to 500 MB</p>
                    </div>
                    {srcTool && (
                      <Badge className={cn("text-xs", srcTool.color)}>
                        Tagging as {srcTool.label}
                      </Badge>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />

            {/* Library */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Reference Library
              </p>
              {loadingLibrary ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Film className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No reference media yet</p>
                  <p className="text-xs mt-1">Upload HeyGen or Higgsfield content to get started</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map(item => {
                    const src = SOURCE_TOOLS.find(t => t.id === item.source_tool);
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSelected(selected?.id === item.id ? null : item)}
                        className={cn(
                          "w-full text-left rounded-lg border p-3 transition-all flex items-center gap-3 group",
                          selected?.id === item.id
                            ? "border-primary/50 bg-primary/5"
                            : "border-border/30 hover:border-border/60 bg-card/40"
                        )}
                      >
                        <div className="p-1.5 rounded-md bg-muted/50 shrink-0">
                          {item.media_type === "video"
                            ? <Film className="h-4 w-4 text-muted-foreground" />
                            : <Image className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          {src && <Badge className={cn("text-[10px] mt-0.5", src.color)}>{src.label}</Badge>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.status === "analyzing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                          {item.status === "ready"     && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                          {item.status === "error"     && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                          <button
                            onClick={e => { e.stopPropagation(); deleteItem(item.id); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-all"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Analysis + Blueprint */}
          <div className="xl:col-span-2 space-y-5">
            {!selected ? (
              <div className="h-full flex flex-col items-center justify-center py-24 text-center">
                <div className="p-4 rounded-2xl bg-muted/20 mb-4">
                  <Sparkles className="h-12 w-12 text-primary/40" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Upload reference content to begin</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Drop a HeyGen avatar video, a Higgsfield cinematic clip, or a Canva export.
                  Gemini AI will deconstruct every production technique and give you an exact
                  MAVIS blueprint to recreate it.
                </p>
              </div>
            ) : selected.status === "analyzing" ? (
              <div className="h-full flex flex-col items-center justify-center py-24 text-center">
                <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
                <h3 className="text-lg font-semibold mb-2">Analyzing with Gemini AI</h3>
                <p className="text-sm text-muted-foreground">
                  Deconstructing production techniques, identifying tools, building your blueprint...
                </p>
              </div>
            ) : selected.status === "error" ? (
              <Card className="border-red-500/20 bg-red-500/5">
                <CardContent className="py-8 text-center">
                  <XCircle className="h-8 w-8 text-red-500 mx-auto mb-3" />
                  <p className="font-medium">Analysis failed</p>
                  <p className="text-sm text-muted-foreground mt-1">{selected.error_message}</p>
                </CardContent>
              </Card>
            ) : analysis ? (
              <>
                {/* Content Overview */}
                <Card className="border-border/50">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
                        <ContentIcon className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-xs capitalize">
                            {(analysis.content_type ?? "unknown").replace(/_/g, " ")}
                          </Badge>
                          {analysis.production_complexity && (
                            <Badge variant="outline" className="text-xs capitalize">
                              {analysis.production_complexity} complexity
                            </Badge>
                          )}
                          {analysis.style_profile?.format && (
                            <Badge variant="outline" className="text-xs">
                              {analysis.style_profile.format}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-foreground leading-relaxed">{analysis.description}</p>
                        {analysis.what_makes_it_effective && (
                          <p className="text-xs text-muted-foreground mt-2 border-l-2 border-primary/30 pl-3">
                            {analysis.what_makes_it_effective}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Elements Detected */}
                {Array.isArray(analysis.elements) && analysis.elements.length > 0 && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-3 pt-4">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Layers className="h-4 w-4 text-primary" />
                        Production Elements Detected
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(analysis.elements as any[]).map((el: any, i: number) => (
                        <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/20 border border-border/20">
                          <div className="p-1 rounded bg-muted/50 shrink-0 mt-0.5">
                            {el.name?.toLowerCase().includes("voice") || el.name?.toLowerCase().includes("audio") || el.name?.toLowerCase().includes("music")
                              ? <Mic className="h-3 w-3 text-muted-foreground" />
                              : el.name?.toLowerCase().includes("text") || el.name?.toLowerCase().includes("overlay")
                              ? <Type className="h-3 w-3 text-muted-foreground" />
                              : el.name?.toLowerCase().includes("music") || el.name?.toLowerCase().includes("sound")
                              ? <Music className="h-3 w-3 text-muted-foreground" />
                              : <Eye className="h-3 w-3 text-muted-foreground" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold">{el.name}</p>
                            <p className="text-[11px] text-muted-foreground leading-snug">{el.description}</p>
                            {el.likely_tool && (
                              <p className="text-[10px] text-primary/70 mt-0.5">Made with: {el.likely_tool}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Style + Cost */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {analysis.style_profile && (
                    <Card className="border-border/50">
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <Palette className="h-3.5 w-3.5" /> Style Profile
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0 space-y-1.5">
                        {Object.entries(analysis.style_profile as Record<string, string>).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-xs">
                            <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                            <span className="font-medium capitalize">{v}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  <Card className="border-border/50">
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <DollarSign className="h-3.5 w-3.5" /> Tool & Cost Intelligence
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                      {Array.isArray(analysis.original_tools_detected) && (
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Detected tools</p>
                          <div className="flex flex-wrap gap-1">
                            {(analysis.original_tools_detected as string[]).map((t: string) => (
                              <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {analysis.original_cost_estimate && (
                        <p className="text-xs text-muted-foreground">
                          Original cost: <span className="text-foreground font-medium">{analysis.original_cost_estimate}</span>
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Blueprint */}
                {blueprint && (
                  <Card className="border-primary/20 bg-primary/3">
                    <CardHeader className="pb-3 pt-5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Wand2 className="h-5 w-5 text-primary" />
                          MAVIS Production Blueprint
                        </CardTitle>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {blueprint.estimated_total_time && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" /> {blueprint.estimated_total_time}
                            </span>
                          )}
                          {blueprint.estimated_cost_per_video && (
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3.5 w-3.5" /> {blueprint.estimated_cost_per_video} / video
                            </span>
                          )}
                        </div>
                      </div>
                      {blueprint.overview && (
                        <p className="text-sm text-muted-foreground mt-1">{blueprint.overview}</p>
                      )}
                      {blueprint.monthly_savings_vs_original && (
                        <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium">
                          <Zap className="h-3 w-3" />
                          {blueprint.monthly_savings_vs_original}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="pt-0 space-y-3">
                      {/* Steps */}
                      {Array.isArray(blueprint.steps) && (blueprint.steps as BlueprintStep[]).map((step) => {
                        const route = MAVIS_TOOL_ROUTES[step.mavis_tool] ?? "/mavis";
                        return (
                          <div
                            key={step.step}
                            className="rounded-xl border border-border/40 bg-background/60 p-4 space-y-2"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                                  {step.step}
                                </div>
                                <div>
                                  <p className="text-sm font-semibold">{step.title}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="shrink-0 h-7 text-xs border-primary/30 hover:bg-primary/10 hover:text-primary"
                                onClick={() => navigate(route)}
                              >
                                Open <ChevronRight className="h-3 w-3 ml-0.5" />
                              </Button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pl-9">
                              <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] font-mono">
                                {step.mavis_tool}
                              </Badge>
                              {step.time_estimate && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" /> {step.time_estimate}
                                </span>
                              )}
                            </div>
                            {step.prompt_hint && (
                              <div className="ml-9 text-[11px] text-muted-foreground bg-muted/30 rounded-md px-3 py-1.5 border border-border/20 font-mono leading-relaxed">
                                {step.prompt_hint}
                              </div>
                            )}
                            {Array.isArray(step.alternatives) && step.alternatives.length > 0 && (
                              <p className="ml-9 text-[10px] text-muted-foreground">
                                Backup: {step.alternatives.join(", ")}
                              </p>
                            )}
                          </div>
                        );
                      })}

                      {/* Tool equivalents */}
                      {blueprint.tool_equivalents && Object.keys(blueprint.tool_equivalents as object).length > 0 && (
                        <div className="mt-2 p-3 rounded-lg bg-muted/20 border border-border/20">
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Tool Equivalents</p>
                          <div className="space-y-1.5">
                            {Object.entries(blueprint.tool_equivalents as Record<string, string>).map(([orig, mavis]) => (
                              <div key={orig} className="flex items-center gap-2 text-xs">
                                <span className="font-medium text-muted-foreground min-w-[80px]">{orig}</span>
                                <ArrowRight className="h-3 w-3 text-primary/50 shrink-0" />
                                <span className="text-foreground">{mavis}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Pro tips */}
                      {Array.isArray(blueprint.pro_tips) && blueprint.pro_tips.length > 0 && (
                        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                          <p className="text-xs font-medium text-amber-400/80 mb-1.5 uppercase tracking-wider">Pro Tips</p>
                          <ul className="space-y-1">
                            {(blueprint.pro_tips as string[]).map((tip, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                <Zap className="h-3 w-3 text-amber-400/60 shrink-0 mt-0.5" />
                                {tip}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* CTA */}
                      <div className="flex gap-2 pt-1">
                        <Button
                          className="flex-1"
                          onClick={() => navigate("/creator")}
                        >
                          <Clapperboard className="h-4 w-4 mr-2" />
                          Open Video Studio
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => navigate("/avatar-studio")}
                        >
                          <Bot className="h-4 w-4 mr-2" />
                          Avatar Studio
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
