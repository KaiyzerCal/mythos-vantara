// MAVIS Design Studio — browse, manage, and trigger design generation
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Palette, Plus, Loader2, CheckCircle2, XCircle,
  Package, FileCode2, RefreshCw, ChevronDown, ChevronRight,
  Zap, Clock, DollarSign, Copy, Check, Eye, Code2, Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import { runDesignEngine } from "@/mavis/design/designEngine";
import type { DesignBrief, GeneratedFile } from "@/mavis/design/types";
import {
  SandpackProvider,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";

const BRANDS = ["codexos", "vantara", "skyforgeai", "bioneer", "navi", "custom"] as const;
const DEADLINE_TIERS = ["rapid", "standard", "premium"] as const;

interface Project {
  id: string;
  project_name: string;
  brand: string;
  project_goal: string;
  status: string;
  deadline_tier: string;
  project_value: number | null;
  generated_files: GeneratedFile[] | null;
  quality_gate_results: { passed: boolean; failedChecks: string[] } | null;
  created_at: string;
}

interface Component {
  id: string;
  component_name: string;
  component_type: string;
  tags: string[];
  times_used: number;
  tsx_code: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  brief_received: "text-muted-foreground border-border",
  analyzing:      "text-amber-400 border-amber-800",
  designing:      "text-blue-400 border-blue-800",
  generating:     "text-primary border-primary/50",
  quality_check:  "text-purple-400 border-purple-800",
  complete:       "text-green-400 border-green-800",
  failed:         "text-red-400 border-red-800",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
      title="Copy code"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function buildSandpackFiles(files: GeneratedFile[]): Record<string, string> {
  const sandpackFiles: Record<string, string> = {};

  // Map generated files to sandpack paths
  files.forEach((f) => {
    const path = f.path.startsWith("/") ? f.path : `/${f.path}`;
    sandpackFiles[path] = f.content;
  });

  // Determine entry point — prefer App.tsx, index.tsx, or first tsx file
  const entryFile =
    files.find((f) => f.path.endsWith("App.tsx") || f.path === "App.tsx")?.path ??
    files.find((f) => f.path.endsWith("index.tsx"))?.path ??
    files.find((f) => f.type === "tsx")?.path;

  // Always provide a working index.tsx that imports from the entry component
  if (entryFile && !files.some((f) => f.path === "index.tsx" || f.path === "/index.tsx")) {
    const importPath = `./${entryFile.replace(/^\//, "").replace(/\.tsx$/, "")}`;
    sandpackFiles["/index.tsx"] = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "${importPath}";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);`;
  }

  // Merge any CSS into styles.css or provide a blank one with Tailwind directives
  const cssFiles = files.filter((f) => f.type === "css");
  if (cssFiles.length > 0 && !sandpackFiles["/styles.css"]) {
    sandpackFiles["/styles.css"] = cssFiles.map((f) => f.content).join("\n\n");
  } else if (!sandpackFiles["/styles.css"]) {
    sandpackFiles["/styles.css"] = "/* generated styles */";
  }

  return sandpackFiles;
}

function FileViewer({ files }: { files: GeneratedFile[] }) {
  const [activeTab, setActiveTab] = useState<"code" | "preview">("preview");
  const [activeFile, setActiveFile] = useState(files[0]?.path ?? "");
  const file = files.find((f) => f.path === activeFile);

  const sandpackFiles = buildSandpackFiles(files);

  const handleDownload = () => {
    const lines: string[] = ["# Generated Project Files\n"];
    files.forEach((f) => {
      lines.push(`\n## ${f.path}\n\`\`\`${f.type}\n${f.content}\n\`\`\``);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "generated_project.md";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Project files downloaded as Markdown");
  };

  return (
    <div className="mt-4 space-y-3">
      {/* Tab bar */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setActiveTab("preview")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono rounded border transition-colors ${
            activeTab === "preview"
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border/50 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Eye size={10} /> Live Preview
        </button>
        <button
          onClick={() => setActiveTab("code")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono rounded border transition-colors ${
            activeTab === "code"
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border/50 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Code2 size={10} /> Code
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono rounded border border-border/50 text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          <Download size={10} /> Download
        </button>
      </div>

      {activeTab === "preview" && (
        <div className="rounded-lg overflow-hidden border border-border">
          <SandpackProvider
            template="react-ts"
            files={sandpackFiles}
            customSetup={{
              dependencies: {
                "framer-motion": "^11.0.0",
                "lucide-react": "^0.400.0",
                "tailwind-merge": "^2.0.0",
                "class-variance-authority": "^0.7.0",
                "clsx": "^2.0.0",
              },
            }}
            options={{
              externalResources: ["https://cdn.tailwindcss.com"],
            }}
            theme="dark"
          >
            <SandpackLayout>
              <SandpackPreview
                style={{ height: 520 }}
                showOpenInCodeSandbox
                showRefreshButton
              />
            </SandpackLayout>
          </SandpackProvider>
        </div>
      )}

      {activeTab === "code" && (
        <div className="rounded-lg overflow-hidden border border-border">
          {/* File tabs */}
          <div className="flex overflow-x-auto border-b border-border bg-muted/20">
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => setActiveFile(f.path)}
                className={`shrink-0 px-3 py-2 text-[10px] font-mono transition-colors border-r border-border last:border-r-0 ${
                  activeFile === f.path
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.path.split("/").pop()}
              </button>
            ))}
          </div>
          {file && (
            <div className="relative">
              <div className="absolute top-2 right-2 z-10">
                <CopyButton text={file.content} />
              </div>
              <SandpackProvider
                template="react-ts"
                files={sandpackFiles}
                options={{ activeFile: file.path.startsWith("/") ? file.path : `/${file.path}` }}
                theme="dark"
              >
                <SandpackLayout>
                  <SandpackCodeEditor style={{ height: 400 }} showLineNumbers showTabs={false} />
                </SandpackLayout>
              </SandpackProvider>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const [expanded, setExpanded] = useState(false);
  const statusClass = STATUS_COLORS[project.status] ?? STATUS_COLORS.brief_received;
  const files = project.generated_files ?? [];

  return (
    <HudCard className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${statusClass}`}>
              {project.status.replace("_", " ")}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground">{project.brand}</span>
            <span className="text-[9px] font-mono text-muted-foreground">{timeAgo(project.created_at)}</span>
          </div>
          <p className="text-sm font-display font-bold">{project.project_name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{project.project_goal}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {project.project_value && (
            <span className="text-[9px] font-mono text-green-400 flex items-center gap-0.5">
              <DollarSign size={9} />
              {project.project_value.toLocaleString()}
            </span>
          )}
          {project.status === "complete" && files.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className={`flex items-center gap-1 px-2 py-1 text-[9px] font-mono rounded border transition-colors ${
                expanded
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30"
              }`}
            >
              <Eye size={10} />
              {expanded ? "Close" : "Preview"}
            </button>
          )}
        </div>
      </div>

      {project.status === "complete" && project.quality_gate_results && (
        <div className="flex items-center gap-2">
          {project.quality_gate_results.passed ? (
            <span className="text-[9px] font-mono text-green-400 flex items-center gap-1">
              <CheckCircle2 size={10} /> All quality checks passed
            </span>
          ) : (
            <span className="text-[9px] font-mono text-amber-400 flex items-center gap-1">
              <XCircle size={10} />
              {project.quality_gate_results.failedChecks.length} check{project.quality_gate_results.failedChecks.length !== 1 ? "s" : ""} need attention
            </span>
          )}
          {files.length > 0 && (
            <span className="text-[9px] font-mono text-muted-foreground flex items-center gap-1">
              <FileCode2 size={9} /> {files.length} file{files.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      <AnimatePresence>
        {expanded && files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <FileViewer files={files} />
          </motion.div>
        )}
      </AnimatePresence>
    </HudCard>
  );
}

// ─── NEW PROJECT FORM ─────────────────────────────────────────

interface NewProjectFormProps {
  onComplete: () => void;
  onCancel: () => void;
  userId: string;
}

function NewProjectForm({ onComplete, onCancel, userId }: NewProjectFormProps) {
  const [generating, setGenerating] = useState(false);
  const [brief, setBrief] = useState<Partial<DesignBrief>>({
    brand: "codexos",
    deadlineTier: "standard",
    keyFeatures: [],
  });
  const [featuresInput, setFeaturesInput] = useState("");
  const [competitorsInput, setCompetitorsInput] = useState("");

  async function handleGenerate() {
    if (!brief.projectName || !brief.projectGoal || !brief.targetAudience) {
      toast.error("Project name, goal, and target audience are required");
      return;
    }
    setGenerating(true);
    try {
      const fullBrief: DesignBrief = {
        projectName:    brief.projectName!,
        brand:          brief.brand ?? "codexos",
        projectGoal:    brief.projectGoal!,
        targetAudience: brief.targetAudience!,
        keyFeatures:    featuresInput ? featuresInput.split(",").map((f) => f.trim()).filter(Boolean) : [],
        aestheticDirectives: brief.aestheticDirectives,
        competitorUrls: competitorsInput ? competitorsInput.split(",").map((u) => u.trim()).filter(Boolean) : [],
        userJourney:    brief.userJourney,
        deadlineTier:   brief.deadlineTier ?? "standard",
        clientName:     brief.clientName,
        projectValue:   brief.projectValue,
      };
      await runDesignEngine(userId, fullBrief);
      toast.success("Design generation complete — project saved");
      onComplete();
    } catch (err) {
      toast.error(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  }

  const field = (
    key: keyof DesignBrief,
    label: string,
    placeholder: string,
    optional = false,
  ) => (
    <div>
      <label className="block text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">
        {label}{!optional && <span className="text-primary ml-1">*</span>}
      </label>
      <input
        type="text"
        placeholder={placeholder}
        value={(brief[key] as string) ?? ""}
        onChange={(e) => setBrief((prev) => ({ ...prev, [key]: e.target.value }))}
        className="w-full bg-muted/20 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors"
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-mono text-primary uppercase tracking-widest">New Design Brief</h2>
        <button
          onClick={onCancel}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {field("projectName", "Project Name", "SkyforgeAI Landing Page")}
        {field("projectGoal", "Project Goal", "Convert cold traffic to free trial signups")}
      </div>
      {field("targetAudience", "Target Audience", "Solo operators frustrated with Zapier complexity")}

      <div>
        <label className="block text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">
          Key Features <span className="text-muted-foreground/50">(comma-separated)</span>
        </label>
        <input
          type="text"
          placeholder="Hero, pricing table, testimonials, CTA"
          value={featuresInput}
          onChange={(e) => setFeaturesInput(e.target.value)}
          className="w-full bg-muted/20 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors"
        />
      </div>

      {field("aestheticDirectives", "Aesthetic Directives", "Energetic, results-driven, orange accent", true)}
      {field("userJourney", "User Journey", "Land → Understand → Trust → Convert", true)}

      <div>
        <label className="block text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">
          Competitor URLs <span className="text-muted-foreground/50">(comma-separated, optional)</span>
        </label>
        <input
          type="text"
          placeholder="https://zapier.com, https://make.com"
          value={competitorsInput}
          onChange={(e) => setCompetitorsInput(e.target.value)}
          className="w-full bg-muted/20 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors"
        />
      </div>

      <div>
        <label className="block text-[10px] font-mono text-muted-foreground mb-2 uppercase tracking-wider">Brand</label>
        <div className="flex gap-2 flex-wrap">
          {BRANDS.map((b) => (
            <button
              key={b}
              onClick={() => setBrief((prev) => ({ ...prev, brand: b }))}
              className={`px-3 py-1.5 text-[10px] font-mono rounded border transition-colors ${
                brief.brand === b
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-mono text-muted-foreground mb-2 uppercase tracking-wider">Deadline Tier</label>
        <div className="flex gap-2">
          {DEADLINE_TIERS.map((t) => (
            <button
              key={t}
              onClick={() => setBrief((prev) => ({ ...prev, deadlineTier: t }))}
              className={`px-3 py-1.5 text-[10px] font-mono rounded border transition-colors ${
                brief.deadlineTier === t
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {field("clientName", "Client Name", "Acme Corp", true)}
        <div>
          <label className="block text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">
            Project Value <span className="text-muted-foreground/50">(USD, optional)</span>
          </label>
          <input
            type="number"
            placeholder="5000"
            value={brief.projectValue ?? ""}
            onChange={(e) => setBrief((prev) => ({ ...prev, projectValue: e.target.value ? Number(e.target.value) : undefined }))}
            className="w-full bg-muted/20 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={generating || !brief.projectName || !brief.projectGoal || !brief.targetAudience}
        className="w-full py-3.5 bg-primary text-primary-foreground rounded-lg font-mono text-sm font-bold disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
      >
        {generating ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            MAVIS is generating...
          </>
        ) : (
          <>
            <Zap size={14} />
            Generate with MAVIS
          </>
        )}
      </button>

      {generating && (
        <p className="text-[10px] font-mono text-muted-foreground text-center">
          Design generation takes 30-90 seconds. MAVIS is building your full production site.
        </p>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────

export default function DesignStudio() {
  const { session } = useAuth();
  const { lastActionTs } = useAppData();

  const [projects, setProjects] = useState<Project[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [activeTab, setActiveTab] = useState<"projects" | "components" | "new">("projects");
  const [loading, setLoading] = useState(true);

  const userId = session?.user?.id ?? "";

  const load = useCallback(async () => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    const [projectsRes, componentsRes] = await Promise.all([
      (supabase as any)
        .from("mavis_design_projects")
        .select("id, project_name, brand, project_goal, status, deadline_tier, project_value, generated_files, quality_gate_results, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      (supabase as any)
        .from("mavis_design_components")
        .select("id, component_name, component_type, tags, times_used, tsx_code, created_at")
        .eq("user_id", session.user.id)
        .eq("is_reusable", true)
        .order("times_used", { ascending: false })
        .limit(100),
    ]);
    setProjects((projectsRes.data as Project[]) ?? []);
    setComponents((componentsRes.data as Component[]) ?? []);
    setLoading(false);
  }, [session]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (lastActionTs) load(); }, [lastActionTs]); // eslint-disable-line react-hooks/exhaustive-deps

  const TABS = [
    { id: "projects" as const,    label: `Projects (${projects.length})`,     icon: <Palette size={10} /> },
    { id: "components" as const,  label: `Components (${components.length})`, icon: <Package size={10} /> },
    { id: "new" as const,         label: "New Project",                        icon: <Plus size={10} /> },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Design Studio"
        subtitle="MAVIS generates sovereign-grade websites and components"
        icon={<Palette size={18} />}
        actions={
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono bg-muted/30 border border-border text-muted-foreground rounded hover:text-primary hover:border-primary/30 transition-colors"
          >
            <RefreshCw size={10} /> Refresh
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono rounded border transition-colors ${
              activeTab === tab.id
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Projects Tab */}
      {activeTab === "projects" && (
        <section>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-primary" size={20} />
            </div>
          ) : projects.length === 0 ? (
            <HudCard>
              <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                <Palette size={24} className="opacity-30" />
                <p className="text-xs font-mono">No design projects yet.</p>
                <button
                  onClick={() => setActiveTab("new")}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
                >
                  <Plus size={10} /> Generate your first site
                </button>
              </div>
            </HudCard>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {projects.map((project, i) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <ProjectCard project={project} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      )}

      {/* Components Tab */}
      {activeTab === "components" && (
        <section>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-primary" size={20} />
            </div>
          ) : components.length === 0 ? (
            <HudCard>
              <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                <Package size={24} className="opacity-30" />
                <p className="text-xs font-mono">No components yet. Generate a project to build your library.</p>
              </div>
            </HudCard>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {components.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <HudCard className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-mono font-bold">{c.component_name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{c.component_type}</p>
                      </div>
                      <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground">
                        <Clock size={9} />
                        {timeAgo(c.created_at)}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {c.tags?.map((tag) => (
                        <span key={tag} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono text-primary">
                        Used {c.times_used} time{c.times_used !== 1 ? "s" : ""}
                      </span>
                      {c.tsx_code && <CopyButton text={c.tsx_code} />}
                    </div>
                  </HudCard>
                </motion.div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* New Project Tab */}
      {activeTab === "new" && (
        <HudCard>
          <NewProjectForm
            userId={userId}
            onComplete={() => {
              load();
              setActiveTab("projects");
            }}
            onCancel={() => setActiveTab("projects")}
          />
        </HudCard>
      )}
    </div>
  );
}
