// ============================================================
// VANTARA.EXE — WebsiteBuilderPage
// MAVIS website-building service — autonomous client site generation
// ============================================================
import { useState, useEffect } from "react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Globe, Plus, Sparkles, ExternalLink, CheckCircle2,
  Loader2, Copy, Trash2, Eye, Settings, Users,
  DollarSign, Code2, Layers, Zap,
} from "lucide-react";
import { toast } from "sonner";

// ─── Constants ───────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  planning:   "bg-gray-500",
  generating: "bg-amber-500",
  generated:  "bg-blue-500",
  published:  "bg-emerald-500",
  delivered:  "bg-violet-500",
};

const STATUS_TEXT: Record<string, string> = {
  planning:   "text-gray-300",
  generating: "text-amber-300",
  generated:  "text-blue-300",
  published:  "text-emerald-300",
  delivered:  "text-violet-300",
};

const PAGE_TYPE_ICON: Record<string, string> = {
  home: "🏠", about: "👥", services: "⚡", contact: "✉️",
  pricing: "💰", portfolio: "🎨", blog: "📝", team: "👥",
};

const ALL_PAGES = ["home", "about", "services", "contact", "pricing", "portfolio", "blog", "team"];

const BUSINESS_TYPES = [
  { value: "local_business", label: "Local Business" },
  { value: "saas",           label: "SaaS" },
  { value: "agency",         label: "Agency" },
  { value: "ecommerce",      label: "Ecommerce" },
  { value: "restaurant",     label: "Restaurant" },
  { value: "medical",        label: "Medical" },
  { value: "portfolio",      label: "Portfolio" },
  { value: "nonprofit",      label: "Nonprofit" },
];

const STYLES = [
  { value: "modern",     label: "Modern" },
  { value: "corporate",  label: "Corporate" },
  { value: "creative",   label: "Creative" },
  { value: "minimal",    label: "Minimal" },
  { value: "bold",       label: "Bold" },
  { value: "elegant",    label: "Elegant" },
];

const COLOR_SCHEMES = [
  { value: "blue",        label: "Blue" },
  { value: "green",       label: "Green" },
  { value: "purple",      label: "Purple" },
  { value: "orange",      label: "Orange" },
  { value: "red",         label: "Red" },
  { value: "monochrome",  label: "Monochrome" },
];

// ─── Helpers ─────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── WebsiteBuilderPage ──────────────────────────────────────
export default function WebsiteBuilderPage() {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<"projects" | "new">("projects");
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [projectPages, setProjectPages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState("");
  const [generationProgress, setGenerationProgress] = useState(0);
  const [showWpSection, setShowWpSection] = useState(false);
  const [showSiteContent, setShowSiteContent] = useState(false);

  // New website form
  const [form, setForm] = useState({
    client_name: "",
    business_name: "",
    business_type: "local_business",
    description: "",
    target_audience: "",
    unique_value: "",
    location: "",
    style: "modern",
    color_scheme: "blue",
    pages: ["home", "about", "services", "contact"],
    price_cents: 99700,
    wp_site_url: "",
    wp_username: "",
    wp_app_password: "",
  });

  // ── Load projects ─────────────────────────────────────────
  const loadProjects = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from("website_projects")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setProjects(data ?? []);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Load project pages ────────────────────────────────────
  const loadProjectPages = async (projectId: string) => {
    const { data } = await supabase
      .from("website_pages")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    setProjectPages(data ?? []);
  };

  useEffect(() => { loadProjects(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectProject = async (project: any) => {
    setSelectedProject(project);
    await loadProjectPages(project.id);
  };

  // ── Toggle page in form ───────────────────────────────────
  const togglePage = (page: string) => {
    setForm((prev) => ({
      ...prev,
      pages: prev.pages.includes(page)
        ? prev.pages.filter((p) => p !== page)
        : [...prev.pages, page],
    }));
  };

  // ── Generate website ──────────────────────────────────────
  const generateWebsite = async () => {
    if (!user || !form.business_name || !form.description) {
      toast.error("Business name and description are required");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0);

    try {
      // Step 1: Create project record
      setGenerationStep("Creating project...");
      setGenerationProgress(10);

      const { data: project, error: projErr } = await supabase
        .from("website_projects")
        .insert({
          user_id: user.id,
          project_name: `${form.business_name} Website`,
          ...form,
          status: "generating",
        })
        .select()
        .single();

      if (projErr) throw projErr;

      // Step 2: Call mavis-web-builder
      setGenerationStep("AI is generating your website content...");
      setGenerationProgress(30);

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-web-builder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "generate_site",
          ...form,
          user_id: user.id,
          project_id: project.id,
          wp_site_url: form.wp_site_url || undefined,
          wp_username: form.wp_username || undefined,
          wp_app_password: form.wp_app_password || undefined,
        }),
      });

      setGenerationProgress(70);
      setGenerationStep("Publishing pages to WordPress...");

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Build failed: ${errText.slice(0, 200)}`);
      }

      const result = await res.json();
      setGenerationProgress(100);
      setGenerationStep("Complete!");

      // Update project with result
      await supabase
        .from("website_projects")
        .update({
          status: result.pages_published > 0 ? "published" : "generated",
          pages_count: result.pages_published ?? 0,
          site_content: result.site_content,
          hero_image_url: result.hero_image_url,
          preview_url: result.preview_url,
        })
        .eq("id", project.id);

      toast.success(`Website built! ${result.pages_published ?? 0} pages published.`);

      setActiveTab("projects");
      await loadProjects();
      setSelectedProject({ ...project, status: "published", preview_url: result.preview_url });
      await loadProjectPages(project.id);

    } catch (err: any) {
      toast.error(err.message ?? "Generation failed");
      setGenerationStep("");
    } finally {
      setIsGenerating(false);
      setGenerationProgress(0);
    }
  };

  // ── Copy to clipboard ─────────────────────────────────────
  const copyToClipboard = (text: string, label = "Copied") => {
    navigator.clipboard.writeText(text);
    toast.success(label);
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="text-primary" size={24} />
            Website Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build high-converting client websites autonomously with MAVIS AI
          </p>
        </div>
        <Button onClick={() => setActiveTab("new")} className="gap-2">
          <Plus size={16} />
          New Website
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["projects", "new"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-mono transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "projects" ? `Projects (${projects.length})` : "New Website"}
          </button>
        ))}
      </div>

      {/* ── PROJECTS TAB ─────────────────────────────────── */}
      {activeTab === "projects" && (
        <div className="flex gap-5 min-h-[600px]">
          {/* Left: project list */}
          <div className="w-72 shrink-0 flex flex-col gap-2 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={22} className="animate-spin text-primary" />
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <div className="p-4 rounded-full bg-muted/30 border border-border">
                  <Globe size={28} className="text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No projects yet.</p>
                <Button size="sm" variant="outline" onClick={() => setActiveTab("new")} className="gap-1.5">
                  <Plus size={13} /> Create First Website
                </Button>
              </div>
            ) : (
              projects.map((project) => {
                const isSelected = selectedProject?.id === project.id;
                return (
                  <button
                    key={project.id}
                    onClick={() => handleSelectProject(project)}
                    className={`text-left w-full rounded-lg border p-3 transition-all ${
                      isSelected
                        ? "border-primary/60 bg-primary/5 shadow-sm"
                        : "border-border/50 bg-card/50 hover:border-border hover:bg-card"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className={`text-sm font-semibold leading-snug truncate ${isSelected ? "text-primary" : "text-foreground"}`}>
                        {project.business_name || project.project_name}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_TEXT[project.status] ?? "text-muted-foreground"} bg-muted/40 border border-border/50`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[project.status] ?? "bg-gray-500"}`} />
                        {project.status}
                      </span>
                    </div>
                    {project.client_name && (
                      <p className="text-[11px] text-muted-foreground mb-1">Client: {project.client_name}</p>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                      <span>{project.pages_count ?? 0} pages</span>
                      <span>{fmtDate(project.created_at)}</span>
                    </div>
                    {project.price_cents > 0 && (
                      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                        <DollarSign size={9} />
                        {fmtDollars(project.price_cents)}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Right: project detail */}
          <div className="flex-1 min-w-0">
            {selectedProject ? (
              <div className="space-y-4">
                {/* Project header card */}
                <Card className="border-primary/20">
                  <CardHeader className="pb-3 pt-4 px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg font-bold">
                          {selectedProject.business_name || selectedProject.project_name}
                        </CardTitle>
                        {selectedProject.client_name && (
                          <CardDescription className="mt-0.5">
                            Client: {selectedProject.client_name}
                          </CardDescription>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-full border ${STATUS_TEXT[selectedProject.status] ?? "text-muted-foreground"} bg-muted/30 border-border/50`}>
                          <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[selectedProject.status] ?? "bg-gray-500"}`} />
                          {selectedProject.status}
                        </span>
                        {selectedProject.preview_url && (
                          <a
                            href={selectedProject.preview_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs font-mono text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 px-2.5 py-1 rounded-full transition-colors"
                          >
                            <ExternalLink size={11} />
                            Preview
                          </a>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-5 pb-4 space-y-2">
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground font-mono">
                      {selectedProject.business_type && (
                        <span className="flex items-center gap-1"><Layers size={11} /> {selectedProject.business_type.replace("_", " ")}</span>
                      )}
                      {selectedProject.style && (
                        <span className="flex items-center gap-1"><Eye size={11} /> {selectedProject.style}</span>
                      )}
                      {selectedProject.price_cents > 0 && (
                        <span className="flex items-center gap-1 text-emerald-400"><DollarSign size={11} /> {fmtDollars(selectedProject.price_cents)}</span>
                      )}
                      <span className="flex items-center gap-1"><Globe size={11} /> {selectedProject.pages_count ?? 0} pages</span>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedProject.preview_url && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs h-8"
                          onClick={() => copyToClipboard(selectedProject.preview_url, "Preview URL copied")}
                        >
                          <Copy size={11} />
                          Copy Preview URL
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs h-8"
                        onClick={() => toast.info("Regenerate coming soon")}
                      >
                        <Sparkles size={11} />
                        Regenerate Page
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs h-8"
                        onClick={() => toast.info("Add page coming soon")}
                      >
                        <Plus size={11} />
                        Add Page
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Pages */}
                {projectPages.length > 0 && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <Code2 size={13} />
                        Published Pages
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 space-y-2">
                      {projectPages.map((page: any) => (
                        <div
                          key={page.id}
                          className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0"
                        >
                          <span className="text-base">{PAGE_TYPE_ICON[page.page_type] ?? "📄"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium capitalize">{page.page_type || page.page_name}</p>
                            {page.wp_url && (
                              <a
                                href={page.wp_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-mono text-primary/70 hover:text-primary truncate block max-w-xs"
                              >
                                {page.wp_url}
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {page.wp_url && (
                              <>
                                <a
                                  href={page.wp_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                                >
                                  <ExternalLink size={12} />
                                </a>
                                <button
                                  onClick={() => copyToClipboard(page.wp_url, "URL copied")}
                                  className="p-1.5 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                                >
                                  <Copy size={12} />
                                </button>
                              </>
                            )}
                            <CheckCircle2 size={14} className="text-emerald-400" />
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Site content collapsible */}
                {selectedProject.site_content && (
                  <Card className="border-border/50">
                    <button
                      className="w-full px-5 py-3 flex items-center justify-between text-left"
                      onClick={() => setShowSiteContent((v) => !v)}
                    >
                      <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <Layers size={13} />
                        Site Content Summary
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">{showSiteContent ? "▲ hide" : "▼ show"}</span>
                    </button>
                    {showSiteContent && (
                      <CardContent className="px-5 pb-4">
                        <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap bg-muted/20 rounded p-3 max-h-60 overflow-y-auto leading-relaxed">
                          {typeof selectedProject.site_content === "string"
                            ? selectedProject.site_content
                            : JSON.stringify(selectedProject.site_content, null, 2)}
                        </pre>
                      </CardContent>
                    )}
                  </Card>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center text-muted-foreground">
                <Globe size={36} className="opacity-20" />
                <p className="text-sm">Select a project to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── NEW WEBSITE TAB ───────────────────────────────── */}
      {activeTab === "new" && (
        <div className="max-w-3xl space-y-5">
          {/* Generation progress overlay */}
          {isGenerating && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="px-5 py-5 space-y-3">
                <div className="flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-primary">Generating Website...</p>
                    <p className="text-xs text-muted-foreground font-mono">{generationStep}</p>
                  </div>
                </div>
                <Progress value={generationProgress} className="h-2" />
                <p className="text-[11px] font-mono text-muted-foreground">{generationProgress}% complete</p>
              </CardContent>
            </Card>
          )}

          {/* Section 1: Client Info */}
          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                <Users size={13} />
                Client Info
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground">Client Name</label>
                <Input
                  placeholder="John Smith"
                  value={form.client_name}
                  onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                  className="bg-background/60 border-border/60 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground">Business Name <span className="text-destructive">*</span></label>
                <Input
                  placeholder="Acme Digital Co."
                  value={form.business_name}
                  onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
                  className="bg-background/60 border-border/60 text-sm"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground">Business Type</label>
                <Select
                  value={form.business_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, business_type: v }))}
                >
                  <SelectTrigger className="bg-background/60 border-border/60 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Business Brief */}
          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                <Zap size={13} />
                Business Brief
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground">Description <span className="text-destructive">*</span></label>
                <Textarea
                  placeholder="What does the business do? What problem do they solve?"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="bg-background/60 border-border/60 text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground">Target Audience</label>
                  <Input
                    placeholder="Who are their customers?"
                    value={form.target_audience}
                    onChange={(e) => setForm((f) => ({ ...f, target_audience: e.target.value }))}
                    className="bg-background/60 border-border/60 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground">Unique Value</label>
                  <Input
                    placeholder="What makes them different?"
                    value={form.unique_value}
                    onChange={(e) => setForm((f) => ({ ...f, unique_value: e.target.value }))}
                    className="bg-background/60 border-border/60 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground">Location</label>
                <Input
                  placeholder="City, State — leave blank for online business"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  className="bg-background/60 border-border/60 text-sm"
                />
              </div>
            </CardContent>
          </Card>

          {/* Section 3: Design */}
          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                <Eye size={13} />
                Design
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground">Style</label>
                  <Select value={form.style} onValueChange={(v) => setForm((f) => ({ ...f, style: v }))}>
                    <SelectTrigger className="bg-background/60 border-border/60 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground">Color Scheme</label>
                  <Select value={form.color_scheme} onValueChange={(v) => setForm((f) => ({ ...f, color_scheme: v }))}>
                    <SelectTrigger className="bg-background/60 border-border/60 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_SCHEMES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Page checkboxes */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground">Pages to Generate</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_PAGES.map((page) => {
                    const active = form.pages.includes(page);
                    return (
                      <button
                        key={page}
                        onClick={() => togglePage(page)}
                        className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded border transition-all ${
                          active
                            ? "bg-primary/10 border-primary/40 text-primary"
                            : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                        }`}
                      >
                        {PAGE_TYPE_ICON[page] ?? "📄"} {page.charAt(0).toUpperCase() + page.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 4: WordPress (collapsible) */}
          <Card className="border-border/60">
            <button
              className="w-full px-5 py-3.5 flex items-center justify-between text-left"
              onClick={() => setShowWpSection((v) => !v)}
            >
              <span className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                <Globe size={13} />
                WordPress (Optional)
              </span>
              <span className="text-xs font-mono text-muted-foreground">{showWpSection ? "▲ hide" : "▼ show"}</span>
            </button>
            {showWpSection && (
              <CardContent className="px-5 pb-5 space-y-3 pt-0">
                <p className="text-xs text-muted-foreground">Connect a WordPress site to publish pages directly via the REST API.</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground">WP Site URL</label>
                  <Input
                    placeholder="https://yourclient.com"
                    value={form.wp_site_url}
                    onChange={(e) => setForm((f) => ({ ...f, wp_site_url: e.target.value }))}
                    className="bg-background/60 border-border/60 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-mono text-muted-foreground">WP Username</label>
                    <Input
                      placeholder="admin"
                      value={form.wp_username}
                      onChange={(e) => setForm((f) => ({ ...f, wp_username: e.target.value }))}
                      className="bg-background/60 border-border/60 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-mono text-muted-foreground">App Password</label>
                    <Input
                      type="password"
                      placeholder="xxxx xxxx xxxx xxxx"
                      value={form.wp_app_password}
                      onChange={(e) => setForm((f) => ({ ...f, wp_app_password: e.target.value }))}
                      className="bg-background/60 border-border/60 text-sm"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() => toast.info("WP connection test coming soon")}
                >
                  <Settings size={12} />
                  Test Connection
                </Button>
              </CardContent>
            )}
          </Card>

          {/* Section 5: Pricing */}
          <Card className="border-border/60">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                <DollarSign size={13} />
                Pricing
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground">Project Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={(form.price_cents / 100).toFixed(2)}
                    onChange={(e) => setForm((f) => ({ ...f, price_cents: Math.round(parseFloat(e.target.value || "0") * 100) }))}
                    className="bg-background/60 border-border/60 text-sm pl-7"
                  />
                </div>
                <p className="text-[11px] font-mono text-muted-foreground">{fmtDollars(form.price_cents)} — stored on project record</p>
              </div>
            </CardContent>
          </Card>

          {/* Generate button */}
          <Button
            size="lg"
            onClick={generateWebsite}
            disabled={isGenerating || !form.business_name || !form.description}
            className="w-full gap-2 text-base h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20 disabled:opacity-40"
          >
            {isGenerating ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Generating — {generationStep}
              </>
            ) : (
              <>
                <Sparkles size={18} />
                Generate Website
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
