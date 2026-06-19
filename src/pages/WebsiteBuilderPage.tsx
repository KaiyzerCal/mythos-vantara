// ============================================================
// VANTARA.EXE — WebsiteBuilderPage
// MAVIS website-building service — autonomous client site generation
// ============================================================
import { useState, useEffect, useRef } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Globe, Plus, Sparkles, ExternalLink, CheckCircle2,
  Loader2, Copy, Trash2, Eye, Settings, Users,
  DollarSign, Code2, Layers, Zap, Download, FileCode, Link2, Unlink, Upload,
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
  const [showAddPagePicker, setShowAddPagePicker] = useState(false);
  const [addingPageType, setAddingPageType] = useState("");
  const [isAddingPage, setIsAddingPage] = useState(false);
  const [previewPageId, setPreviewPageId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [pendingEdits, setPendingEdits] = useState<Record<string, { html: string; text: string }>>({});
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [exportingPageId, setExportingPageId] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [importingPageType, setImportingPageType] = useState<string | null>(null);
  const [isImportingAll, setIsImportingAll] = useState(false);
  const htmlImportRef = useRef<HTMLInputElement>(null);
  const htmlMultiImportRef = useRef<HTMLInputElement>(null);

  // Multi-provider deployment
  type DeployProvider = "netlify" | "vercel" | "cloudflare" | "railway" | "hostinger";
  const [deployProvider, setDeployProvider] = useState<DeployProvider>(() =>
    (localStorage.getItem("deploy_provider") as DeployProvider) ?? "netlify"
  );
  const [deployTokens, setDeployTokens] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("deploy_tokens");
      const parsed: Record<string, string> = saved ? JSON.parse(saved) : {};
      // Migrate old netlify token
      if (!parsed.netlify) parsed.netlify = localStorage.getItem("netlify_token") ?? "";
      return parsed;
    } catch { return {}; }
  });
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  // Pages excluded from deploy (all enabled by default)
  const [disabledPages, setDisabledPages] = useState<Set<string>>(new Set());

  // Backward compat aliases used in legacy code below
  const netlifyToken = deployTokens.netlify ?? "";
  const isDeployingToNetlify = isDeploying && deployProvider === "netlify";
  const netlifyUrl = deployedUrl;

  // WordPress.com OAuth — new project form
  const [wpAuthMode, setWpAuthMode] = useState<"app_password" | "wpcom">("app_password");
  const [wpcomCred, setWpcomCred] = useState<{
    access_token: string;
    wpcom_blog_id: number;
    wpcom_site_domain: string;
  } | null>(null);
  const [isConnectingWpcom, setIsConnectingWpcom] = useState(false);

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
        .select("*, website_pages(count)")
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
      .order("created_at", { ascending: false }); // newest first
    // Deduplicate by page_type — keep the most-recently updated record.
    // (Guard against missing UNIQUE constraint causing duplicate rows.)
    const byType = new Map<string, any>();
    for (const p of data ?? []) {
      if (!byType.has(p.page_type)) byType.set(p.page_type, p);
    }
    setProjectPages([...byType.values()]);
  };

  useEffect(() => { loadProjects(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Contenteditable postMessage bridge ───────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ELEMENT_CHANGED') {
        setPendingEdits(prev => ({
          ...prev,
          [event.data.path]: { html: event.data.html, text: event.data.text }
        }));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleSelectProject = async (project: any) => {
    setSelectedProject(project);
    setDeployedUrl((project as any).deploy_url ?? project.netlify_site_url ?? null);
    setDisabledPages(new Set());
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
          // Use WP.com OAuth creds if connected, otherwise fall back to app-password fields
          ...(wpcomCred ? {
            access_token: wpcomCred.access_token,
            wpcom_blog_id: wpcomCred.wpcom_blog_id,
            wp_site_url: wpcomCred.wpcom_site_domain,
          } : {
            wp_site_url: form.wp_site_url || undefined,
            wp_username: form.wp_username || undefined,
            wp_app_password: form.wp_app_password || undefined,
          }),
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

      const totalPages = result.pages_generated ?? result.pages_published ?? 0;
      // Update project with result
      await supabase
        .from("website_projects")
        .update({
          status: result.pages_published > 0 ? "published" : "generated",
          pages_count: totalPages,
          site_content: result.site_content,
          hero_image_url: result.hero_image_url,
          preview_url: result.preview_url,
        })
        .eq("id", project.id);

      toast.success(`Website built! ${totalPages} pages generated${result.pages_published > 0 ? `, ${result.pages_published} published to WordPress` : ""}.`);

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

  // ── Regenerate existing project ───────────────────────────
  const handleRegenerate = async (project: any) => {
    if (!user || isGenerating) return;
    setIsGenerating(true);
    setGenerationStep("Re-generating site content...");
    setGenerationProgress(10);
    try {
      await supabase.from("website_projects").update({ status: "generating" }).eq("id", project.id);
      setSelectedProject((p: any) => ({ ...p, status: "generating" }));

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-web-builder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: "generate_site",
          business_name: project.business_name,
          business_type: project.business_type,
          description: project.description,
          target_audience: project.target_audience,
          unique_value: project.unique_value,
          location: project.location,
          style: project.style,
          color_scheme: project.color_scheme,
          pages: project.pages ?? project.pages_requested ?? ["home", "about", "services", "contact"],
          price_cents: project.price_cents,
          client_name: project.client_name,
          wp_site_url: project.wp_site_url || undefined,
          wp_username: project.wp_username || undefined,
          wp_app_password: project.wp_app_password || undefined,
          user_id: user.id,
          project_id: project.id,
        }),
      });

      setGenerationProgress(70);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Build failed: ${errText.slice(0, 200)}`);
      }

      const result = await res.json();
      setGenerationProgress(100);
      setGenerationStep("Complete!");

      const regenTotal = result.pages_generated ?? result.pages_published ?? 0;
      await supabase.from("website_projects").update({
        status: result.pages_published > 0 ? "published" : "generated",
        pages_count: regenTotal,
        site_content: result.site_content,
        hero_image_url: result.hero_image_url,
        preview_url: result.preview_url,
      }).eq("id", project.id);

      toast.success(`Regenerated! ${regenTotal} pages built${result.pages_published > 0 ? `, ${result.pages_published} published to WordPress` : ""}.`);
      await loadProjects();
      await loadProjectPages(project.id);
      setSelectedProject((p: any) => ({
        ...p,
        status: result.pages_published > 0 ? "published" : "generated",
        pages_count: regenTotal,
        site_content: result.site_content,
        hero_image_url: result.hero_image_url,
        preview_url: result.preview_url,
      }));
    } catch (err: any) {
      toast.error(err.message ?? "Regeneration failed");
      await supabase.from("website_projects").update({ status: "planning" }).eq("id", project.id);
      setSelectedProject((p: any) => ({ ...p, status: "planning" }));
    } finally {
      setIsGenerating(false);
      setGenerationProgress(0);
      setGenerationStep("");
    }
  };

  // ── Copy to clipboard ─────────────────────────────────────
  const copyToClipboard = (text: string, label = "Copied") => {
    navigator.clipboard.writeText(text);
    toast.success(label);
  };

  // ── WordPress.com OAuth connect ───────────────────────────
  const connectWordPressCom = async (projectId?: string) => {
    if (!user || isConnectingWpcom) return;
    setIsConnectingWpcom(true);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-wpcom-oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: "get_auth_url", user_id: user.id, project_id: projectId ?? null }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();

      // Open OAuth popup
      const popup = window.open(url, "wpcom_oauth", "width=620,height=720,left=200,top=80");

      // Listen for the postMessage from WpcomCallbackPage
      const handler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === "wpcom_oauth_success") {
          const { access_token, wpcom_blog_id, wpcom_site_domain } = event.data;
          setWpcomCred({ access_token, wpcom_blog_id, wpcom_site_domain });
          if (projectId) {
            // Update the selected project's wp_site_url to reflect the connected domain
            setSelectedProject((p: any) => p ? { ...p, wp_site_url: wpcom_site_domain } : p);
          }
          toast.success(`Connected to ${wpcom_site_domain ?? "WordPress.com"}!`);
          window.removeEventListener("message", handler);
          clearInterval(pollClosed);
        } else if (event.data?.type === "wpcom_oauth_error") {
          toast.error(`WP.com error: ${event.data.error}`);
          window.removeEventListener("message", handler);
          clearInterval(pollClosed);
        }
        setIsConnectingWpcom(false);
      };
      window.addEventListener("message", handler);

      // Clean up if popup is closed without completing auth
      const pollClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollClosed);
          window.removeEventListener("message", handler);
          setIsConnectingWpcom(false);
        }
      }, 800);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to start WordPress.com auth");
      setIsConnectingWpcom(false);
    }
  };

  // ── Add a single new page to an existing project ──────────
  const handleAddPage = async () => {
    if (!user || !selectedProject || !addingPageType || isAddingPage) return;
    setIsAddingPage(true);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();

      let pageContent = selectedProject.site_content?.pages?.[addingPageType];
      let primaryColor = selectedProject.site_content?.site?.primary_color ?? "#1a56db";

      // If content for this page type isn't cached, generate it
      if (!pageContent) {
        const planRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-web-builder`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            action: "plan_site",
            business_name: selectedProject.business_name,
            business_type: selectedProject.business_type,
            description: selectedProject.description,
            target_audience: selectedProject.target_audience,
            unique_value: selectedProject.unique_value,
            location: selectedProject.location,
            style: selectedProject.style,
            color_scheme: selectedProject.color_scheme,
            pages: [addingPageType],
          }),
        });
        if (planRes.ok) {
          const planData = await planRes.json();
          pageContent = planData.content?.pages?.[addingPageType];
          primaryColor = planData.content?.site?.primary_color ?? primaryColor;
        }
      }

      // Build standalone HTML
      const allPageKeys = Object.keys(selectedProject?.site_content?.pages ?? {});
      const pageListForNav = allPageKeys.length > 0 ? allPageKeys : [addingPageType];
      const genRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-web-builder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          action: "generate_page",
          page_type: addingPageType,
          page_content: pageContent ?? {},
          primary_color: primaryColor,
          site_title: selectedProject?.business_name ?? selectedProject?.project_name ?? "Website",
          page_list: pageListForNav,
        }),
      });

      if (!genRes.ok) {
        const errText = await genRes.text();
        throw new Error(`Page generation failed: ${errText.slice(0, 200)}`);
      }
      const genData = await genRes.json();

      // Upsert into website_pages (UNIQUE constraint on project_id + page_type)
      const { error: upsertErr } = await supabase.from("website_pages").upsert({
        project_id: selectedProject.id,
        user_id: user.id,
        page_type: addingPageType,
        slug: addingPageType,
        status: "generated",
        gutenberg_html: genData.html,
      }, { onConflict: "project_id,page_type" });
      if (upsertErr) throw upsertErr;

      const newCount = (selectedProject.pages_count ?? 0) + 1;
      await supabase.from("website_projects").update({ pages_count: newCount }).eq("id", selectedProject.id);

      toast.success(`${addingPageType} page generated!`);
      setShowAddPagePicker(false);
      setAddingPageType("");
      setSelectedProject((p: any) => ({ ...p, pages_count: newCount }));
      await loadProjectPages(selectedProject.id);
      await loadProjects();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to add page");
    } finally {
      setIsAddingPage(false);
    }
  };

  // ── Generate HTML for one page and trigger a browser download ─
  const exportPageHtml = async (pageType: string, dbPage?: any): Promise<string | null> => {
    // Use cached DB row first
    if (dbPage?.gutenberg_html) {
      triggerHtmlDownload(dbPage.gutenberg_html, pageType);
      return dbPage.gutenberg_html;
    }

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const { data: { session } } = await supabase.auth.getSession();
    const pageContent = selectedProject?.site_content?.pages?.[pageType] ?? {};
    const primaryColor = selectedProject?.site_content?.site?.primary_color ?? "#1a56db";

    const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-web-builder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        action: "generate_page",
        page_type: pageType,
        page_content: pageContent,
        primary_color: primaryColor,
        hero_image_url: pageType === "home" ? selectedProject?.hero_image_url : undefined,
        site_title: selectedProject?.business_name ?? selectedProject?.project_name ?? "Website",
        page_list: Object.keys(selectedProject?.site_content?.pages ?? {}),
        business_type: selectedProject?.business_type,
        style: selectedProject?.style,
      }),
    });
    if (!res.ok) throw new Error(`Failed to generate HTML for ${pageType}`);
    const data = await res.json();
    const html: string = data.html;

    triggerHtmlDownload(html, pageType);

    // Cache back to DB row if it exists
    if (dbPage?.id) {
      await supabase.from("website_pages").update({ gutenberg_html: html }).eq("id", dbPage.id);
    }
    return html;
  };

  const triggerHtmlDownload = (html: string, pageType: string) => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pageType}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Export a single page ──────────────────────────────────
  const handleExportFromContent = async (pageType: string, dbPage?: any) => {
    if (exportingPageId === pageType) return;
    setExportingPageId(pageType);
    try {
      await exportPageHtml(pageType, dbPage);
      toast.success(`${pageType}.html downloaded`);
    } catch (err: any) {
      toast.error(err.message ?? "Export failed");
    } finally {
      setExportingPageId(null);
    }
  };

  // ── Save a deploy token ────────────────────────────────────
  const saveDeployToken = (key: string, value: string) => {
    const next = { ...deployTokens, [key]: value };
    setDeployTokens(next);
    localStorage.setItem("deploy_tokens", JSON.stringify(next));
  };

  // ── Unified deploy / download ──────────────────────────────
  const deployToNetlify = async () => deploy(); // backward compat

  const deploy = async () => {
    if (isDeploying) return;
    if (!selectedProject) return;
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

    // Validate credentials
    if (deployProvider === "netlify" && !deployTokens.netlify)
      return toast.error("Enter your Netlify personal access token first");
    if (deployProvider === "vercel" && !deployTokens.vercel)
      return toast.error("Enter your Vercel personal access token first");
    if (deployProvider === "cloudflare" && (!deployTokens.cloudflare_token || !deployTokens.cloudflare_account_id))
      return toast.error("Enter your Cloudflare API token and Account ID first");

    setIsDeploying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const primaryColor = selectedProject?.site_content?.site?.primary_color ?? "#1a56db";
      const siteTitle = selectedProject?.business_name ?? selectedProject?.project_name ?? "Website";

      // Re-fetch pages directly from the DB right now so the deploy always uses
      // the latest stored HTML — not whatever is currently in React state.
      const { data: rawPages } = await supabase
        .from("website_pages")
        .select("*")
        .eq("project_id", selectedProject.id)
        .order("created_at", { ascending: false });

      const byType = new Map<string, any>();
      for (const p of rawPages ?? []) {
        if (!byType.has(p.page_type)) byType.set(p.page_type, p);
      }
      const latestPages = [...byType.values()];

      // Compute deployable page types from the fresh DB data
      const seenTypes = new Set<string>();
      const pageTypesToDeploy: string[] = [];
      for (const t of Object.keys(selectedProject?.site_content?.pages ?? {})) {
        if (!seenTypes.has(t)) { seenTypes.add(t); pageTypesToDeploy.push(t); }
      }
      for (const p of latestPages) {
        if (p.gutenberg_html && !seenTypes.has(p.page_type)) {
          seenTypes.add(p.page_type); pageTypesToDeploy.push(p.page_type);
        }
      }

      // Filter out pages the user has toggled off
      const filteredPageTypes = pageTypesToDeploy.filter(t => !disabledPages.has(t));

      if (filteredPageTypes.length === 0) {
        toast.error("No pages to deploy — enable at least one page or generate pages first.");
        return;
      }

      // Build files dict — DB HTML always wins; only regenerate when no HTML is stored.
      const files: Record<string, string> = {};
      for (const pageType of filteredPageTypes) {
        const dbPage = latestPages.find((p: any) => p.page_type === pageType);
        if (dbPage?.gutenberg_html) {
          files[pageType === "home" ? "index.html" : `${pageType}.html`] = dbPage.gutenberg_html;
          continue;
        }
        // No stored HTML — regenerate from site_content if available
        const pageContent = selectedProject?.site_content?.pages?.[pageType];
        if (!pageContent) continue;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-web-builder`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            action: "generate_page",
            page_type: pageType,
            page_content: pageContent,
            primary_color: primaryColor,
            site_title: siteTitle,
            page_list: filteredPageTypes,
            business_type: selectedProject?.business_type,
            style: selectedProject?.style,
          }),
        });
        if (res.ok) {
          const d = await res.json();
          files[pageType === "home" ? "index.html" : `${pageType}.html`] = d.html;
        }
      }

      if (Object.keys(files).length === 0) { toast.error("No pages to deploy"); return; }

      // Ensure root always resolves — if no index.html was produced, promote the first file
      if (!files["index.html"]) {
        files["index.html"] = files[Object.keys(files)[0]];
      }

      const pageCount = Object.keys(files).length;
      const uploadedCount = filteredPageTypes.filter(pt => {
        const p = latestPages.find((pg: any) => pg.page_type === pt);
        return p?.status === "customized" && p.gutenberg_html;
      }).length;
      toast.info(`Deploying ${pageCount} page${pageCount !== 1 ? "s" : ""}${uploadedCount > 0 ? ` · ${uploadedCount} from your uploads` : ""}…`);

      // ── Build provider-specific payload ─────────────────────
      const slug = siteTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const existingProjectId = (selectedProject as any).deploy_project_id
        ?? selectedProject.netlify_site_id;

      const providerPayload: Record<string, unknown> = { provider: deployProvider, files };
      if (deployProvider === "netlify") {
        providerPayload.token = deployTokens.netlify;
        providerPayload.site_id = existingProjectId ?? undefined;
        providerPayload.site_name = `mavis-${slug}-${selectedProject.id?.slice(0, 6)}`;
      } else if (deployProvider === "vercel") {
        providerPayload.token = deployTokens.vercel;
        providerPayload.project_name = `mavis-${slug}`;
      } else if (deployProvider === "cloudflare") {
        providerPayload.token = deployTokens.cloudflare_token;
        providerPayload.account_id = deployTokens.cloudflare_account_id;
        providerPayload.project_name = existingProjectId ?? `mavis-${slug}`;
      }
      // railway / hostinger: no credentials needed — returns base64 ZIP

      const deployRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerPayload),
      });

      if (!deployRes.ok) {
        const errText = await deployRes.text();
        throw new Error(`Deploy failed (${deployProvider}): ${errText.slice(0, 200)}`);
      }
      const deployData = await deployRes.json();

      // ── ZIP download for Railway / Hostinger ─────────────────
      if (deployProvider === "railway" || deployProvider === "hostinger") {
        const zipBase64: string = deployData.zip;
        const binary = atob(zipBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${slug || "website"}.zip`; a.click();
        URL.revokeObjectURL(url);
        toast.success(`ZIP downloaded — upload it to your ${deployProvider === "railway" ? "Railway" : "Hostinger"} static hosting.`);
        return;
      }

      // ── Persist deploy metadata for API-based providers ──────
      const liveUrl: string = deployData.deploy_url ?? "";
      const projectId: string = deployData.project_id ?? existingProjectId ?? "";

      const updatePayload: Record<string, any> = {
        deploy_provider: deployProvider,
        deploy_project_id: projectId,
      };
      if (liveUrl) updatePayload.deploy_url = liveUrl;

      // Also keep legacy Netlify columns in sync
      if (deployProvider === "netlify") {
        updatePayload.netlify_site_id = projectId;
        if (liveUrl) updatePayload.netlify_site_url = liveUrl;
        if (deployData.deploy_id) updatePayload.netlify_deploy_id = deployData.deploy_id;
        updatePayload.netlify_deploy_status = "ready";
      }

      await supabase.from("website_projects").update(updatePayload).eq("id", selectedProject.id);

      const finalUrl = liveUrl || (selectedProject as any).deploy_url || selectedProject.netlify_site_url;
      setSelectedProject((p: any) => ({ ...p, deploy_url: liveUrl, deploy_project_id: projectId, netlify_site_id: projectId, netlify_site_url: finalUrl }));
      if (finalUrl) setDeployedUrl(finalUrl);

      const providerLabel = { netlify: "Netlify", vercel: "Vercel", cloudflare: "Cloudflare Pages" }[deployProvider] ?? deployProvider;
      toast.success(`Site deployed to ${providerLabel}!`);
    } catch (err: any) {
      toast.error(err.message ?? "Deployment failed");
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Open a page's HTML in a new browser tab for preview ──
  const openPagePreview = (dbPage?: any) => {
    const html = dbPage?.gutenberg_html;
    if (!html) {
      toast.error("No HTML to preview — generate or upload this page first.");
      return;
    }
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  // ── Unified list of all deployable page types ─────────────
  // Combines MAVIS-generated pages (from site_content) + manually
  // uploaded pages (from projectPages), deduplicating by page_type.
  const allDeployablePageTypes: string[] = (() => {
    const seen = new Set<string>();
    const types: string[] = [];
    for (const t of Object.keys(selectedProject?.site_content?.pages ?? {})) {
      if (!seen.has(t)) { seen.add(t); types.push(t); }
    }
    for (const p of projectPages) {
      if (p.gutenberg_html && !seen.has(p.page_type)) {
        seen.add(p.page_type); types.push(p.page_type);
      }
    }
    return types;
  })();

  // ── Download every page as individual HTML files ──────────
  const handleDownloadAll = async () => {
    if (isDownloadingAll) return;
    if (allDeployablePageTypes.length === 0) {
      toast.error("No pages available — generate or upload pages first.");
      return;
    }
    setIsDownloadingAll(true);
    let downloaded = 0;
    try {
      for (const pageType of allDeployablePageTypes) {
        const dbPage = projectPages.find((p: any) => p.page_type === pageType);
        try {
          await exportPageHtml(pageType, dbPage);
          downloaded++;
          await new Promise((r) => setTimeout(r, 600));
        } catch {
          // continue
        }
      }
      toast.success(`${downloaded} of ${allDeployablePageTypes.length} pages downloaded`);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  // ── Import an HTML file back into a page ─────────────────
  const handleImportHtml = (pageType: string) => {
    setImportingPageType(pageType);
    htmlImportRef.current?.click();
  };

  const handleImportHtmlFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so the same file can be re-selected later
    e.target.value = "";
    if (!file || !importingPageType || !selectedProject || !user) {
      setImportingPageType(null);
      return;
    }

    const html = await file.text();
    const pageType = importingPageType;
    setImportingPageType(null);

    try {
      const { error } = await supabase.from("website_pages").upsert({
        project_id: selectedProject.id,
        user_id: user.id,
        page_type: pageType,
        slug: pageType,
        status: "customized",
        gutenberg_html: html,
      }, { onConflict: "project_id,page_type" });

      if (error) throw error;
      toast.success(`${pageType}.html imported — page updated.`);
      await loadProjectPages(selectedProject.id);
    } catch (err: any) {
      toast.error(err.message ?? "Import failed");
    }
  };

  // ── Bulk HTML import (multiple pages at once) ─────────────
  const detectPageTypeFromFilename = (filename: string): string => {
    const base = filename.replace(/\.html?$/i, "").toLowerCase().trim();
    if (base === "index") return "home";
    const known = ["home", "about", "services", "contact", "pricing", "portfolio", "blog", "team"];
    return known.includes(base) ? base : base;
  };

  const handleImportAllHtmlFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !selectedProject || !user) return;

    setIsImportingAll(true);
    let imported = 0;
    const errors: string[] = [];

    try {
      for (const file of files) {
        const pageType = detectPageTypeFromFilename(file.name);
        try {
          const html = await file.text();
          const { error } = await supabase.from("website_pages").upsert({
            project_id: selectedProject.id,
            user_id: user.id,
            page_type: pageType,
            slug: pageType,
            status: "customized",
            gutenberg_html: html,
          }, { onConflict: "project_id,page_type" });
          if (error) throw error;
          imported++;
        } catch (err: any) {
          errors.push(`${file.name}: ${err.message ?? "failed"}`);
        }
      }

      if (imported > 0) {
        // Update pages_count on project
        const newCount = Math.max(selectedProject.pages_count ?? 0, imported);
        await supabase.from("website_projects").update({ pages_count: newCount }).eq("id", selectedProject.id);
        setSelectedProject((p: any) => ({ ...p, pages_count: newCount }));
        await loadProjectPages(selectedProject.id);
        await loadProjects();
      }

      if (errors.length === 0) {
        toast.success(`${imported} page${imported !== 1 ? "s" : ""} imported successfully.`);
      } else {
        toast.warning(`${imported} imported, ${errors.length} failed: ${errors[0]}`);
      }
    } finally {
      setIsImportingAll(false);
    }
  };

  // ── Save inline edits back to the DB ─────────────────────
  const saveInlineEdits = async () => {
    if (!previewPageId || Object.keys(pendingEdits).length === 0) return;
    setIsSavingEdits(true);
    try {
      const { data: page } = await supabase
        .from('website_pages')
        .select('gutenberg_html')
        .eq('id', previewPageId)
        .single();

      if (page?.gutenberg_html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(page.gutenberg_html, 'text/html');

        Object.entries(pendingEdits).forEach(([path, { html }]) => {
          try {
            const el = doc.querySelector(path);
            if (el) el.innerHTML = html;
          } catch { /* invalid selector — skip */ }
        });

        const updatedHtml = doc.documentElement.outerHTML;

        await supabase
          .from('website_pages')
          .update({ gutenberg_html: updatedHtml })
          .eq('id', previewPageId);

        // Refresh local state so the iframe re-renders with saved content
        await loadProjectPages(selectedProject.id);
      }

      setPendingEdits({});
      setPreviewKey(k => k + 1);
      toast.success('Edits saved!');
    } catch (err: any) {
      console.error('Failed to save inline edits:', err);
      toast.error(err.message ?? 'Failed to save edits');
    } finally {
      setIsSavingEdits(false);
    }
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Hidden file inputs for HTML import */}
      <input
        ref={htmlImportRef}
        type="file"
        accept=".html,text/html"
        className="hidden"
        onChange={handleImportHtmlFile}
      />
      <input
        ref={htmlMultiImportRef}
        type="file"
        accept=".html,text/html"
        multiple
        className="hidden"
        onChange={handleImportAllHtmlFiles}
      />

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
                      <span className={`inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_TEXT[project.status] ?? "text-muted-foreground"} bg-muted/40 border border-border/50`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[project.status] ?? "bg-gray-500"}`} />
                        {project.status}
                      </span>
                    </div>
                    {project.client_name && (
                      <p className="text-xs text-muted-foreground mb-1">Client: {project.client_name}</p>
                    )}
                    <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                      <span>{project.website_pages?.[0]?.count ?? project.pages_count ?? 0} pages</span>
                      <span>{fmtDate(project.created_at)}</span>
                    </div>
                    {project.price_cents > 0 && (
                      <div className="mt-1.5 flex items-center gap-1 text-xs text-emerald-400 font-mono">
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
                      {selectedProject.site_content?.pages && (
                        <Button
                          size="sm"
                          className="gap-1.5 text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={isDownloadingAll}
                          onClick={handleDownloadAll}
                        >
                          {isDownloadingAll
                            ? <Loader2 size={11} className="animate-spin" />
                            : <Download size={11} />}
                          {isDownloadingAll ? "Downloading..." : "Download HTML"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs h-8"
                        disabled={isImportingAll}
                        title="Upload one or more HTML files. Files are matched to pages by filename (e.g. home.html → home, about.html → about)."
                        onClick={() => htmlMultiImportRef.current?.click()}
                      >
                        {isImportingAll
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Upload size={11} />}
                        {isImportingAll ? "Importing..." : "Upload HTML"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs h-8"
                        disabled={isGenerating}
                        onClick={() => handleRegenerate(selectedProject)}
                      >
                        <Sparkles size={11} className={isGenerating ? "animate-spin" : ""} />
                        {isGenerating ? generationStep || "Generating..." : "Regenerate Site"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs h-8"
                        disabled={isAddingPage}
                        onClick={() => {
                          setShowAddPagePicker((v) => !v);
                          setAddingPageType("");
                        }}
                      >
                        <Plus size={11} />
                        Add Page
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs h-8"
                        disabled={isConnectingWpcom}
                        onClick={() => connectWordPressCom(selectedProject.id)}
                        title={wpcomCred ? `Connected: ${wpcomCred.wpcom_site_domain}` : "Connect WordPress.com"}
                      >
                        {isConnectingWpcom ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : wpcomCred ? (
                          <CheckCircle2 size={11} className="text-emerald-400" />
                        ) : (
                          <Link2 size={11} />
                        )}
                        {wpcomCred ? "WP.com Connected" : "Connect WP.com"}
                      </Button>
                    </div>

                    {/* Inline Add Page picker */}
                    {showAddPagePicker && (() => {
                      const existingTypes = new Set(projectPages.map((p: any) => p.page_type));
                      const available = ALL_PAGES.filter((t) => !existingTypes.has(t));
                      return (
                        <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
                          <p className="text-xs font-mono text-muted-foreground">Select a page type to add:</p>
                          {available.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">All page types already added.</p>
                          ) : (
                            <>
                              <div className="flex flex-wrap gap-2">
                                {available.map((t) => (
                                  <button
                                    key={t}
                                    onClick={() => setAddingPageType(t)}
                                    className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded border transition-all ${
                                      addingPageType === t
                                        ? "bg-primary/10 border-primary/40 text-primary"
                                        : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                                    }`}
                                  >
                                    {PAGE_TYPE_ICON[t] ?? "📄"} {t.charAt(0).toUpperCase() + t.slice(1)}
                                  </button>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  className="gap-1.5 text-xs h-8"
                                  disabled={!addingPageType || isAddingPage}
                                  onClick={handleAddPage}
                                >
                                  {isAddingPage ? (
                                    <><Loader2 size={11} className="animate-spin" /> Generating...</>
                                  ) : (
                                    <><Sparkles size={11} /> Generate {addingPageType ? `${addingPageType.charAt(0).toUpperCase() + addingPageType.slice(1)} ` : ""}Page</>
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs h-8"
                                  onClick={() => { setShowAddPagePicker(false); setAddingPageType(""); }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>

                {/* Pages — shown whenever there are MAVIS-generated or user-uploaded pages */}
                {allDeployablePageTypes.length > 0 && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          <Code2 size={13} />
                          Pages ({allDeployablePageTypes.length - disabledPages.size} of {allDeployablePageTypes.length} enabled)
                        </CardTitle>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => setDisabledPages(new Set())}
                            className="text-xs font-mono px-2 py-1 rounded border border-border/40 text-muted-foreground hover:text-emerald-400 hover:border-emerald-400/30 transition-colors"
                            title="Enable all pages"
                          >all</button>
                          <button
                            onClick={() => setDisabledPages(new Set(allDeployablePageTypes))}
                            className="text-xs font-mono px-2 py-1 rounded border border-border/40 text-muted-foreground hover:text-rose-400 hover:border-rose-400/30 transition-colors"
                            title="Disable all pages"
                          >none</button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-7"
                            disabled={isDownloadingAll}
                            onClick={handleDownloadAll}
                          >
                            {isDownloadingAll
                              ? <Loader2 size={11} className="animate-spin" />
                              : <Download size={11} />}
                            Download All HTML
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 space-y-1">
                      {allDeployablePageTypes.map((pageType) => {
                        const dbPage = projectPages.find((p: any) => p.page_type === pageType);
                        const isExporting = exportingPageId === pageType;
                        const isCustom = dbPage?.status === "customized";
                        const hasHtml = !!dbPage?.gutenberg_html;
                        const isEnabled = !disabledPages.has(pageType);
                        return (
                          <div key={pageType} className={`py-2 border-b border-border/30 last:border-0 transition-opacity ${isEnabled ? "" : "opacity-40"}`}>
                          <div
                            className="flex items-center gap-3"
                          >
                            <Switch
                              checked={isEnabled}
                              onCheckedChange={(checked) => {
                                setDisabledPages(prev => {
                                  const next = new Set(prev);
                                  if (checked) next.delete(pageType);
                                  else next.add(pageType);
                                  return next;
                                });
                              }}
                              className="scale-75 shrink-0"
                            />
                            <span className="text-base">{PAGE_TYPE_ICON[pageType] ?? "📄"}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium capitalize flex items-center gap-1.5">
                                {pageType}
                                {isCustom && (
                                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">custom</span>
                                )}
                              </p>
                              {dbPage?.wp_url && (
                                <a
                                  href={dbPage.wp_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-mono text-primary/70 hover:text-primary truncate block max-w-xs"
                                >
                                  {dbPage.wp_url}
                                </a>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Inline preview toggle */}
                              {hasHtml && (
                                <button
                                  onClick={() => setPreviewPageId((prev) => prev === dbPage?.id ? null : dbPage?.id ?? null)}
                                  className={`flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-mono transition-colors ${previewPageId === dbPage?.id ? "bg-purple-500/10 border-purple-400/40 text-purple-400" : "border-border/50 text-muted-foreground hover:text-purple-400 hover:border-purple-400/30"}`}
                                  title={previewPageId === dbPage?.id ? "Close preview" : "Inline preview"}
                                >
                                  <Eye size={11} /> preview
                                </button>
                              )}
                              {/* Open in new tab */}
                              {hasHtml && (
                                <button
                                  onClick={() => openPagePreview(dbPage)}
                                  className="p-1.5 rounded border border-border/50 text-muted-foreground hover:text-purple-400 hover:border-purple-400/30 transition-colors"
                                  title="Preview in new tab"
                                >
                                  <ExternalLink size={12} />
                                </button>
                              )}
                              {dbPage?.wp_url && (
                                <>
                                  <a
                                    href={dbPage.wp_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                                    title="Open in WordPress"
                                  >
                                    <ExternalLink size={12} />
                                  </a>
                                  <button
                                    onClick={() => copyToClipboard(dbPage.wp_url, "URL copied")}
                                    className="p-1.5 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                                    title="Copy URL"
                                  >
                                    <Copy size={12} />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => handleExportFromContent(pageType, dbPage)}
                                disabled={isExporting || isDownloadingAll}
                                className="flex items-center gap-1 px-2.5 py-1 rounded border border-border/50 text-xs font-mono text-muted-foreground hover:text-emerald-400 hover:border-emerald-400/30 transition-colors disabled:opacity-40"
                                title="Download HTML file"
                              >
                                {isExporting
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <Download size={11} />}
                                .html
                              </button>
                              <button
                                onClick={() => handleImportHtml(pageType)}
                                disabled={importingPageType === pageType}
                                className="flex items-center gap-1 px-2.5 py-1 rounded border border-border/50 text-xs font-mono text-muted-foreground hover:text-blue-400 hover:border-blue-400/30 transition-colors disabled:opacity-40"
                                title="Import customized HTML file"
                              >
                                {importingPageType === pageType
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <Upload size={11} />}
                                import
                              </button>
                              {dbPage?.status === "published" && (
                                <span title="Published to WordPress"><CheckCircle2 size={14} className="text-emerald-400" /></span>
                              )}
                            </div>
                          </div>
                          {/* Inline iframe preview */}
                          {previewPageId === dbPage?.id && dbPage?.gutenberg_html && (
                            <div className="mt-2 space-y-2">
                              {/* Edit mode toolbar */}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { setEditModeEnabled(e => !e); setPendingEdits({}); }}
                                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${editModeEnabled ? 'bg-indigo-100 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                                >
                                  {editModeEnabled ? '✏️ Editing' : '✏️ Edit Text'}
                                </button>
                                {editModeEnabled && (
                                  <span className="text-xs text-indigo-600 font-mono">Click any text in the preview to edit it</span>
                                )}
                              </div>

                              {/* Pending edits banner */}
                              {Object.keys(pendingEdits).length > 0 && (
                                <div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                                  <span className="text-sm text-indigo-700 font-medium">
                                    {Object.keys(pendingEdits).length} unsaved edit{Object.keys(pendingEdits).length > 1 ? 's' : ''}
                                  </span>
                                  <button
                                    onClick={saveInlineEdits}
                                    disabled={isSavingEdits}
                                    className="ml-auto bg-indigo-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                  >
                                    {isSavingEdits ? 'Saving...' : 'Save Changes'}
                                  </button>
                                  <button
                                    onClick={() => setPendingEdits({})}
                                    className="text-sm text-gray-500 hover:text-gray-700"
                                  >
                                    Discard
                                  </button>
                                </div>
                              )}

                              <div className="rounded border border-border overflow-hidden" style={{ height: '400px' }}>
                                <iframe
                                  key={previewKey}
                                  srcDoc={editModeEnabled ? (() => {
                                    const editScript = `<script>
document.querySelectorAll('h1,h2,h3,h4,p,li,span,a,button,label').forEach(el => {
  el.contentEditable = 'true';
  el.style.cursor = 'text';
  el.style.outline = 'none';
  el.addEventListener('focus', () => {
    el.style.boxShadow = '0 0 0 2px #6366f1';
    el.style.borderRadius = '3px';
  });
  el.addEventListener('blur', () => {
    el.style.boxShadow = '';
    const path = getElementPath(el);
    window.parent.postMessage({ type: 'ELEMENT_CHANGED', path, html: el.innerHTML, text: el.innerText }, '*');
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.blur(); }
  });
});
function getElementPath(el) {
  const parts = [];
  let node = el;
  while (node && node !== document.body) {
    const siblings = Array.from(node.parentNode?.children || []);
    const idx = siblings.indexOf(node);
    parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + (idx + 1) + ')');
    node = node.parentNode;
  }
  return parts.join(' > ');
}
<\/script>`;
                                    const html = dbPage.gutenberg_html;
                                    const bodyCloseIdx = html.lastIndexOf('</body>');
                                    return bodyCloseIdx !== -1
                                      ? html.slice(0, bodyCloseIdx) + editScript + html.slice(bodyCloseIdx)
                                      : html + editScript;
                                  })() : dbPage.gutenberg_html}
                                  className="w-full h-full"
                                  sandbox="allow-scripts"
                                  title={`Preview: ${pageType}`}
                                />
                              </div>
                            </div>
                          )}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                {/* Multi-provider publish */}
                {allDeployablePageTypes.length > 0 && (
                  <Card className="border-border/50">
                    <CardHeader className="pb-2 pt-4 px-5">
                      <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <Globe size={13} />
                        Publish to Web
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Deploy all pages as a live website instantly.
                        {((selectedProject as any).deploy_url || selectedProject.netlify_site_url) && (
                          <a
                            href={(selectedProject as any).deploy_url ?? selectedProject.netlify_site_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1 text-emerald-400 hover:underline font-mono"
                          >
                            {(selectedProject as any).deploy_url ?? selectedProject.netlify_site_url}
                          </a>
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 space-y-3">
                      {/* Provider tabs */}
                      <div className="flex gap-1 flex-wrap">
                        {(["netlify","vercel","cloudflare","railway","hostinger"] as const).map(p => (
                          <button
                            key={p}
                            onClick={() => { setDeployProvider(p); localStorage.setItem("deploy_provider", p); }}
                            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${deployProvider === p ? "bg-primary/20 border-primary/60 text-primary" : "border-border/40 text-muted-foreground hover:border-border"}`}
                          >
                            {p === "netlify" ? "Netlify" : p === "vercel" ? "Vercel" : p === "cloudflare" ? "Cloudflare" : p === "railway" ? "Railway" : "Hostinger"}
                          </button>
                        ))}
                      </div>

                      {/* Netlify credentials */}
                      {deployProvider === "netlify" && (
                        <div className="space-y-2">
                          <Input
                            type="password"
                            placeholder="Netlify personal access token"
                            value={deployTokens.netlify ?? ""}
                            onChange={e => saveDeployToken("netlify", e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                          <p className="text-xs text-muted-foreground">
                            app.netlify.com → User settings → Applications → Personal access tokens
                          </p>
                        </div>
                      )}

                      {/* Vercel credentials */}
                      {deployProvider === "vercel" && (
                        <div className="space-y-2">
                          <Input
                            type="password"
                            placeholder="Vercel personal access token"
                            value={deployTokens.vercel ?? ""}
                            onChange={e => saveDeployToken("vercel", e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                          <p className="text-xs text-muted-foreground">
                            vercel.com → Settings → Tokens → Create
                          </p>
                        </div>
                      )}

                      {/* Cloudflare credentials */}
                      {deployProvider === "cloudflare" && (
                        <div className="space-y-2">
                          <Input
                            type="password"
                            placeholder="Cloudflare API token (Pages:Edit)"
                            value={deployTokens.cloudflare_token ?? ""}
                            onChange={e => saveDeployToken("cloudflare_token", e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                          <Input
                            placeholder="Cloudflare Account ID"
                            value={deployTokens.cloudflare_account_id ?? ""}
                            onChange={e => saveDeployToken("cloudflare_account_id", e.target.value)}
                            className="h-8 text-xs font-mono"
                          />
                          <p className="text-xs text-muted-foreground">
                            dash.cloudflare.com → Workers & Pages → your account ID in the sidebar
                          </p>
                        </div>
                      )}

                      {/* Railway / Hostinger — ZIP download */}
                      {(deployProvider === "railway" || deployProvider === "hostinger") && (
                        <div className="rounded-md bg-muted/20 border border-border/40 p-3 text-xs text-muted-foreground space-y-1">
                          <p className="font-medium text-foreground">No credentials needed</p>
                          <p>Click Deploy to download a ZIP of your site files, then upload them to your {deployProvider === "railway" ? "Railway static site" : "Hostinger File Manager"}.</p>
                        </div>
                      )}

                      {/* Deploy button */}
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          className="gap-1.5 text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={isDeploying}
                          onClick={deploy}
                        >
                          {isDeploying
                            ? <Loader2 size={11} className="animate-spin" />
                            : <ExternalLink size={11} />}
                          {isDeploying
                            ? "Deploying…"
                            : (deployProvider === "railway" || deployProvider === "hostinger")
                              ? "Download ZIP"
                              : ((selectedProject as any).deploy_url || selectedProject.netlify_site_url) ? "Redeploy" : "Deploy"}
                        </Button>
                        {deployedUrl && (
                          <a
                            href={deployedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-400 font-mono hover:underline truncate max-w-[260px]"
                          >
                            ✓ {deployedUrl}
                          </a>
                        )}
                      </div>

                      <p className="text-xs text-amber-400">
                        ⚠ Tokens stored in your browser only — never sent to our servers.
                      </p>
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
                        <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap bg-muted/20 rounded p-3 max-h-60 overflow-y-auto leading-relaxed">
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
                <p className="text-xs font-mono text-muted-foreground">{generationProgress}% complete</p>
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
                <p className="text-xs text-muted-foreground">Connect a WordPress site to publish pages directly.</p>

                {/* Auth mode toggle */}
                <div className="flex gap-1 p-1 bg-muted/30 rounded-lg border border-border/50 w-fit">
                  {(["app_password", "wpcom"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setWpAuthMode(mode)}
                      className={`px-3 py-1.5 text-xs font-mono rounded-md transition-all ${
                        wpAuthMode === mode
                          ? "bg-primary/10 text-primary border border-primary/30"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {mode === "app_password" ? "App Password" : "WordPress.com"}
                    </button>
                  ))}
                </div>

                {wpAuthMode === "app_password" ? (
                  <>
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
                  </>
                ) : (
                  <div className="space-y-2">
                    {wpcomCred ? (
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                        <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-emerald-400">Connected</p>
                          <p className="text-xs font-mono text-muted-foreground truncate">{wpcomCred.wpcom_site_domain}</p>
                        </div>
                        <button
                          onClick={() => setWpcomCred(null)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                          title="Disconnect"
                        >
                          <Unlink size={12} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Authorize MAVIS to publish directly to your WordPress.com site via OAuth — no password needed.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs"
                          disabled={isConnectingWpcom}
                          onClick={() => connectWordPressCom()}
                        >
                          {isConnectingWpcom ? (
                            <><Loader2 size={12} className="animate-spin" /> Connecting...</>
                          ) : (
                            <><Link2 size={12} /> Connect WordPress.com</>
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                )}
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
                <p className="text-xs font-mono text-muted-foreground">{fmtDollars(form.price_cents)} — stored on project record</p>
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
