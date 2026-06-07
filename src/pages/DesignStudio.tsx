// MAVIS Design Studio — browse, manage, and trigger design generation
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Palette, Plus, Loader2, CheckCircle2, XCircle,
  Package, FileCode2, RefreshCw, ChevronDown, ChevronRight,
  Zap, Clock, DollarSign, Copy, Check, Eye, Code2, Download,
  Wand2, Layers, Upload, X, Globe,
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

// Known package → pinned version map for common generated deps
const KNOWN_VERSIONS: Record<string, string> = {
  "react-hook-form": "^7.51.0",
  "@hookform/resolvers": "^3.3.4",
  "zod": "^3.22.4",
  "framer-motion": "^11.0.0",
  "lucide-react": "^0.400.0",
  "tailwind-merge": "^2.0.0",
  "class-variance-authority": "^0.7.0",
  "clsx": "^2.0.0",
  "@radix-ui/react-dialog": "^1.0.5",
  "@radix-ui/react-dropdown-menu": "^2.0.6",
  "@radix-ui/react-label": "^2.0.2",
  "@radix-ui/react-select": "^2.0.0",
  "@radix-ui/react-slot": "^1.0.2",
  "@radix-ui/react-tabs": "^1.0.4",
  "@radix-ui/react-toast": "^1.1.5",
  "@radix-ui/react-accordion": "^1.1.2",
  "@radix-ui/react-popover": "^1.0.7",
  "react-router-dom": "^6.22.0",
  "sonner": "^1.4.3",
  "date-fns": "^3.6.0",
  "recharts": "^2.12.0",
  "axios": "^1.6.8",
  "gsap": "^3.12.5",
};

function extractDependencies(files: GeneratedFile[]): Record<string, string> {
  const deps: Record<string, string> = {};
  const importRe = /from\s+['"]([^'"./][^'"]*)['"]/g;
  const requireRe = /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g;

  for (const file of files) {
    for (const re of [importRe, requireRe]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(file.content)) !== null) {
        const pkg = match[1];
        // Get the root package name (e.g. "@hookform/resolvers/zod" → "@hookform/resolvers")
        const root = pkg.startsWith("@")
          ? pkg.split("/").slice(0, 2).join("/")
          : pkg.split("/")[0];
        if (!deps[root]) {
          deps[root] = KNOWN_VERSIONS[root] ?? "latest";
        }
      }
    }
  }

  // Always include base React deps (sandpack template provides them but be explicit)
  return deps;
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
  const detectedDeps = extractDependencies(files);

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
            customSetup={{ dependencies: detectedDeps }}
            options={{ externalResources: ["https://cdn.tailwindcss.com"] }}
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
                customSetup={{ dependencies: detectedDeps }}
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

// ─── DESIGN SYSTEM GENERATOR ─────────────────────────────────

type DSColorPalette = {
  product: string; primary: string; secondary: string; accent: string;
  background: string; foreground: string; card: string; muted: string;
  border: string; muted_fg: string; notes: string;
};

type DSResult = {
  ok: boolean; product_type: string; project_name: string | null; query: string;
  pattern: string; style: string; color_mood: string;
  colors: DSColorPalette | null;
  typography: { name: string; heading: string; body: string; mood: string; css_import: string; tailwind_config: string } | null;
  effects: string; anti_patterns: string[]; checklist: string[];
  severity: string; stack_notes: string;
};

const STACKS = [
  { id: "shadcn",        label: "shadcn/ui" },
  { id: "react",         label: "React + Tailwind" },
  { id: "nextjs",        label: "Next.js" },
  { id: "html-tailwind", label: "HTML + Tailwind" },
] as const;

const DS_SEVERITY_COLORS: Record<string, string> = {
  HIGH:   "text-red-400 border-red-800 bg-red-950/30",
  MEDIUM: "text-amber-400 border-amber-800 bg-amber-950/30",
  LOW:    "text-green-400 border-green-800 bg-green-950/30",
};

function ColorSwatch({ color, label }: { color: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const isHex = /^#[0-9a-fA-F]{3,8}$/.test(color);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(color); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      title={`${label}: ${color}`}
      className="flex flex-col items-center gap-1 group cursor-pointer"
    >
      <div
        className="w-8 h-8 rounded border border-white/10 transition-transform group-hover:scale-110 shadow-sm"
        style={{ backgroundColor: isHex ? color : undefined, background: !isHex ? color : undefined }}
      />
      <span className="text-[8px] font-mono text-muted-foreground group-hover:text-foreground transition-colors">
        {copied ? "copied" : label}
      </span>
    </button>
  );
}

interface HtmlMeta {
  title: string;
  description: string;
  h1: string;
  headings: string[];
  fonts: string[];
  colorHints: string[];
}

function extractHtmlMeta(html: string): HtmlMeta {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const title = doc.querySelector("title")?.textContent?.trim() ?? "";
  const description =
    doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ??
    doc.querySelector('meta[property="og:description"]')?.getAttribute("content")?.trim() ?? "";
  const h1 = doc.querySelector("h1")?.textContent?.trim() ?? "";
  const headings = Array.from(doc.querySelectorAll("h2, h3"))
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 6);

  // Google Fonts from <link> tags
  const fonts = Array.from(doc.querySelectorAll('link[href*="fonts.google"]'))
    .map((el) => {
      const href = (el as HTMLLinkElement).href;
      const m = href.match(/family=([^&:]+)/);
      return m ? decodeURIComponent(m[1]).replace(/\+/g, " ") : null;
    })
    .filter(Boolean) as string[];

  // Crude color extraction from inline styles and style tags
  const styleContent = Array.from(doc.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join(" ");
  const inlineStyles = Array.from(doc.querySelectorAll("[style]"))
    .map((el) => el.getAttribute("style") ?? "")
    .join(" ");
  const hexPattern = /#([0-9a-fA-F]{3,8})\b/g;
  const rawColors = new Set<string>();
  for (const src of [styleContent, inlineStyles]) {
    let m: RegExpExecArray | null;
    hexPattern.lastIndex = 0;
    while ((m = hexPattern.exec(src)) !== null) rawColors.add(m[0]);
  }
  const colorHints = [...rawColors].slice(0, 8);

  return { title, description, h1, headings, fonts, colorHints };
}

interface DesignSystemGeneratorProps {
  userId: string;
  onProjectComplete?: () => void;
}

function DesignSystemGenerator({ userId, onProjectComplete }: DesignSystemGeneratorProps) {
  const [mode, setMode] = useState<"describe" | "clone">("describe");

  // ── Clone from HTML state ──────────────────────────────────
  const [htmlFile, setHtmlFile] = useState<File | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [htmlMeta, setHtmlMeta] = useState<HtmlMeta | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [cloneBrand, setCloneBrand] = useState<string>("custom");
  const [cloneTier, setCloneTier] = useState<string>("standard");

  function handleHtmlFile(file: File) {
    if (!file.name.endsWith(".html") && !file.name.endsWith(".htm")) {
      toast.error("Please upload an .html or .htm file");
      return;
    }
    setHtmlFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setHtmlContent(content);
      const meta = extractHtmlMeta(content);
      setHtmlMeta(meta);
      // Pre-fill design system query from extracted data
      const autoQuery = [
        meta.title && `Website: "${meta.title}"`,
        meta.description && `Description: ${meta.description}`,
        meta.h1 && `Hero: "${meta.h1}"`,
        meta.headings.length > 0 && `Sections: ${meta.headings.join(", ")}`,
        meta.fonts.length > 0 && `Fonts: ${meta.fonts.join(", ")}`,
      ].filter(Boolean).join(". ");
      setQuery(autoQuery || "Cloned website — extract and rebuild the design system");
      setProjectName(meta.title || file.name.replace(/\.html?$/, ""));
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleHtmlFile(file);
  }

  async function handleRebuild() {
    if (!htmlContent || !userId) { toast.error("Upload an HTML file first"); return; }
    if (!projectName.trim()) { toast.error("Project name required"); return; }
    setRebuilding(true);
    try {
      const meta = htmlMeta;
      const brief: import("@/mavis/design/types").DesignBrief = {
        projectName: projectName.trim(),
        brand: cloneBrand as any,
        deadlineTier: cloneTier as any,
        projectGoal: `Rebuild and modernize this website maintaining the same design language, content hierarchy, and sections. Original title: "${meta?.title ?? projectName}". ${meta?.description ?? ""}`.trim(),
        targetAudience: "Same audience as the original website",
        keyFeatures: meta?.headings.slice(0, 5) ?? [],
        aestheticDirectives: [
          meta?.fonts.length ? `Fonts: ${meta.fonts.join(", ")}` : "",
          meta?.colorHints.length ? `Color palette hints: ${meta.colorHints.join(", ")}` : "",
          "Maintain the layout structure and section order from the original HTML",
        ].filter(Boolean).join(". "),
        // Pass truncated HTML as competitor reference in userJourney field
        userJourney: `SOURCE HTML (first 3000 chars for context):\n${htmlContent.slice(0, 3000)}`,
      };
      await runDesignEngine(userId, brief);
      toast.success("Website rebuilt — check the Projects tab");
      onProjectComplete?.();
    } catch (err) {
      toast.error(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRebuilding(false);
    }
  }

  // ── Design System state ────────────────────────────────────
  const [query, setQuery] = useState("");
  const [projectName, setProjectName] = useState("");
  const [stack, setStack] = useState<string>("shadcn");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<DSResult | null>(null);
  const [specCopied, setSpecCopied] = useState(false);

  async function handleGenerate() {
    if (!query.trim()) { toast.error("Describe your product first"); return; }
    setGenerating(true);
    setResult(null);
    try {
      const { data, error } = await (supabase as any).functions.invoke("mavis-design-system-gen", {
        body: { query: query.trim(), project_name: projectName.trim() || undefined, stack },
      });
      if (error) throw new Error(error.message ?? String(error));
      if (!data?.ok) throw new Error(data?.error ?? "Unknown error");
      setResult(data as DSResult);
      toast.success("Design system generated");
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function copySpec() {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setSpecCopied(true);
    setTimeout(() => setSpecCopied(false), 2000);
    toast.success("Design spec copied as JSON");
  }

  const COLOR_KEYS: (keyof DSColorPalette)[] = [
    "primary", "secondary", "accent", "background", "foreground", "card", "muted", "border",
  ];

  return (
    <div className="space-y-5">
      {/* ── Mode toggle ─────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMode("describe")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono rounded border transition-colors ${
            mode === "describe"
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border/50 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Wand2 size={10} /> Describe Product
        </button>
        <button
          onClick={() => setMode("clone")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono rounded border transition-colors ${
            mode === "clone"
              ? "bg-primary/10 border-primary/30 text-primary"
              : "border-border/50 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Upload size={10} /> Clone from HTML
        </button>
      </div>

      {/* ── Clone from HTML ──────────────────────────────────── */}
      {mode === "clone" && (
        <HudCard className="space-y-5">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Clone from HTML</p>
            <p className="text-[10px] font-mono text-muted-foreground/70">
              Upload any .html file — MAVIS will analyze the structure, extract design tokens, and rebuild it as a production React site.
            </p>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("html-file-input")?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 cursor-pointer transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : htmlFile
                ? "border-green-500/50 bg-green-500/5"
                : "border-border/50 hover:border-primary/40 hover:bg-muted/10"
            }`}
          >
            <input
              id="html-file-input"
              type="file"
              accept=".html,.htm"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleHtmlFile(f); }}
            />
            {htmlFile ? (
              <>
                <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                  <FileCode2 size={18} className="text-green-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-mono font-semibold text-green-400">{htmlFile.name}</p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                    {(htmlFile.size / 1024).toFixed(1)} KB · click to replace
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-muted/30 border border-border flex items-center justify-center">
                  <Upload size={18} className="text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-mono text-foreground">Drop your HTML file here</p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5">or click to browse · .html / .htm</p>
                </div>
              </>
            )}
          </div>

          {/* Extracted metadata */}
          {htmlMeta && (
            <div className="space-y-3 border border-border/50 rounded-lg p-4 bg-muted/10">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Extracted from HTML</p>
              <div className="space-y-2">
                {htmlMeta.title && (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-muted-foreground w-20 shrink-0">Title</span>
                    <span className="text-[10px] font-mono text-foreground">{htmlMeta.title}</span>
                  </div>
                )}
                {htmlMeta.h1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-muted-foreground w-20 shrink-0">Hero H1</span>
                    <span className="text-[10px] font-mono text-foreground truncate">{htmlMeta.h1}</span>
                  </div>
                )}
                {htmlMeta.headings.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-mono text-muted-foreground w-20 shrink-0 mt-0.5">Sections</span>
                    <div className="flex flex-wrap gap-1">
                      {htmlMeta.headings.map((h, i) => (
                        <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground">{h}</span>
                      ))}
                    </div>
                  </div>
                )}
                {htmlMeta.fonts.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-mono text-muted-foreground w-20 shrink-0 mt-0.5">Fonts</span>
                    <div className="flex flex-wrap gap-1">
                      {htmlMeta.fonts.map((f, i) => (
                        <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-primary/30 text-primary/80 bg-primary/5">{f}</span>
                      ))}
                    </div>
                  </div>
                )}
                {htmlMeta.colorHints.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-muted-foreground w-20 shrink-0">Colors</span>
                    <div className="flex gap-1.5">
                      {htmlMeta.colorHints.map((c, i) => (
                        <div
                          key={i}
                          className="w-5 h-5 rounded border border-white/10"
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Project name + brand/tier for rebuild */}
          {htmlFile && (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Project Name <span className="text-primary">*</span>
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="MyClonedSite"
                  className="w-full bg-muted/20 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-mono text-muted-foreground mb-2 uppercase tracking-wider">Brand</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {BRANDS.map((b) => (
                      <button
                        key={b}
                        onClick={() => setCloneBrand(b)}
                        className={`px-2.5 py-1 text-[10px] font-mono rounded border transition-colors ${
                          cloneBrand === b
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
                  <label className="block text-[10px] font-mono text-muted-foreground mb-2 uppercase tracking-wider">Tier</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DEADLINE_TIERS.map((t) => (
                      <button
                        key={t}
                        onClick={() => setCloneTier(t)}
                        className={`px-2.5 py-1 text-[10px] font-mono rounded border transition-colors ${
                          cloneTier === t
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={handleRebuild}
                disabled={rebuilding || !projectName.trim()}
                className="w-full py-3.5 bg-primary text-primary-foreground rounded-lg font-mono text-sm font-bold disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                {rebuilding ? (
                  <><Loader2 size={14} className="animate-spin" /> MAVIS is rebuilding...</>
                ) : (
                  <><Globe size={14} /> Rebuild this Website</>
                )}
              </button>
              {rebuilding && (
                <p className="text-[10px] font-mono text-muted-foreground text-center">
                  MAVIS is analyzing the HTML structure and generating a full production site. Takes 30-90 seconds.
                </p>
              )}
            </div>
          )}
        </HudCard>
      )}

      {/* ── Describe Product (original form) ─────────────────── */}
      {mode === "describe" && (
      <HudCard className="space-y-4">
        <div>
          <label className="block text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">
            Product Description <span className="text-primary">*</span>
          </label>
          <textarea
            rows={3}
            placeholder="E.g. SaaS dashboard for indie hackers tracking MRR, churn, and LTV — dark, data-dense, professional"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-muted/20 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors resize-none"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">
              Project Name <span className="text-muted-foreground/50">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="MetricsOS"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full bg-muted/20 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-muted-foreground mb-2 uppercase tracking-wider">Stack</label>
            <div className="flex gap-2 flex-wrap">
              {STACKS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStack(s.id)}
                  className={`px-2.5 py-1 text-[10px] font-mono rounded border transition-colors ${
                    stack === s.id
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "border-border/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || !query.trim()}
          className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-mono text-sm font-bold disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
        >
          {generating ? (
            <><Loader2 size={14} className="animate-spin" /> Analyzing design context...</>
          ) : (
            <><Wand2 size={14} /> Generate Design System</>
          )}
        </button>
      </HudCard>

      )} {/* end mode === "describe" */}

      {result && mode === "describe" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Header */}
          <HudCard className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${DS_SEVERITY_COLORS[result.severity] ?? DS_SEVERITY_COLORS.MEDIUM}`}>
                    {result.severity} COMPLEXITY
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground">{result.product_type}</span>
                </div>
                <p className="text-sm font-display font-bold">{result.project_name ?? result.product_type}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{result.pattern}</p>
              </div>
              <button
                onClick={copySpec}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-mono border border-border/50 rounded hover:border-primary/30 hover:text-primary text-muted-foreground transition-colors"
              >
                {specCopied ? <Check size={10} /> : <Copy size={10} />}
                {specCopied ? "Copied" : "Copy JSON"}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[["Style", result.style], ["Color Mood", result.color_mood], ["Effects", result.effects]].map(([label, val]) => (
                <div key={label} className="p-2.5 rounded border border-border/50 bg-muted/10">
                  <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                  <p className="text-xs font-mono text-foreground">{val}</p>
                </div>
              ))}
            </div>
          </HudCard>

          {/* Color palette */}
          {result.colors && (
            <HudCard className="space-y-3">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Color Palette — click to copy</p>
              <div className="flex gap-5 flex-wrap">
                {COLOR_KEYS.map((key) => (
                  <ColorSwatch key={key} color={(result.colors as DSColorPalette)[key]} label={key} />
                ))}
              </div>
              {result.colors.notes && (
                <p className="text-[10px] font-mono text-muted-foreground italic">{result.colors.notes}</p>
              )}
            </HudCard>
          )}

          {/* Typography */}
          {result.typography && (
            <HudCard className="space-y-3">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Typography — {result.typography.name}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded border border-border/50 bg-muted/10">
                  <p className="text-[9px] font-mono text-muted-foreground mb-1">Heading</p>
                  <p className="text-sm font-mono font-bold">{result.typography.heading}</p>
                </div>
                <div className="p-2.5 rounded border border-border/50 bg-muted/10">
                  <p className="text-[9px] font-mono text-muted-foreground mb-1">Body</p>
                  <p className="text-sm font-mono">{result.typography.body}</p>
                </div>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">{result.typography.mood}</p>
              <div className="relative">
                <div className="absolute top-2 right-2"><CopyButton text={result.typography.css_import} /></div>
                <pre className="text-[10px] font-mono text-muted-foreground bg-muted/20 rounded p-3 overflow-x-auto pr-8 whitespace-pre-wrap">{result.typography.css_import}</pre>
              </div>
              <div className="relative">
                <div className="absolute top-2 right-2"><CopyButton text={result.typography.tailwind_config} /></div>
                <pre className="text-[10px] font-mono text-muted-foreground bg-muted/20 rounded p-3 overflow-x-auto pr-8 whitespace-pre-wrap">{result.typography.tailwind_config}</pre>
              </div>
            </HudCard>
          )}

          {/* Stack notes */}
          <HudCard className="space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Stack Integration — {stack}</p>
            <p className="text-xs font-mono text-muted-foreground leading-relaxed">{result.stack_notes}</p>
          </HudCard>

          {/* Anti-patterns + Checklist */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <HudCard className="space-y-2">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Anti-Patterns — Avoid</p>
              <ul className="space-y-1.5">
                {result.anti_patterns.map((ap, i) => (
                  <li key={i} className="flex items-start gap-2 text-[10px] font-mono text-red-400/80">
                    <XCircle size={10} className="shrink-0 mt-0.5" />{ap}
                  </li>
                ))}
              </ul>
            </HudCard>
            <HudCard className="space-y-2">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Quality Checklist</p>
              <ul className="space-y-1.5">
                {result.checklist.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-[10px] font-mono text-green-400/80">
                    <CheckCircle2 size={10} className="shrink-0 mt-0.5" />{item}
                  </li>
                ))}
              </ul>
            </HudCard>
          </div>
        </motion.div>
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
  const [activeTab, setActiveTab] = useState<"projects" | "components" | "new" | "design-system">("projects");
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
    { id: "projects" as const,       label: `Projects (${projects.length})`,     icon: <Palette size={10} /> },
    { id: "components" as const,     label: `Components (${components.length})`, icon: <Package size={10} /> },
    { id: "new" as const,            label: "New Project",                        icon: <Plus size={10} /> },
    { id: "design-system" as const,  label: "Design System",                      icon: <Layers size={10} /> },
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

      {/* Design System Tab */}
      {activeTab === "design-system" && (
        <DesignSystemGenerator
          userId={userId}
          onProjectComplete={() => { load(); setActiveTab("projects"); }}
        />
      )}
    </div>
  );
}
