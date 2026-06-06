// ============================================================
// VANTARA.EXE — StandingOrderTemplatesPage
// Reusable procedure templates with curator lifecycle.
// Inspired by Hermes skills system (YAML frontmatter + curator loop).
// ============================================================
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Plus, Trash2, Archive, Star, Clock, CheckCircle2,
  XCircle, ChevronDown, ChevronRight, Loader2, Edit2, Save, X, Play,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
type SOStatus = "active" | "archived" | "pinned";

interface SOTemplate {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  description: string | null;
  instructions: string;
  category: string;
  version: number;
  status: SOStatus;
  usage_count: number;
  success_count: number;
  last_used_at: string | null;
  next_run_at: string | null;
  cron_expression: string | null;
  created_by_agent: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface SOExecution {
  id: string;
  template_id: string | null;
  template_slug: string | null;
  status: string;
  result: string | null;
  error_message: string | null;
  turns_used: number;
  started_at: string;
  completed_at: string | null;
  triggered_by: string;
}

interface CreateForm {
  name: string;
  slug: string;
  description: string;
  instructions: string;
  category: string;
  tags: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  general:  "General",
  finance:  "Finance",
  research: "Research",
  creative: "Creative",
  health:   "Health",
};

const STATUS_COLORS: Record<string, string> = {
  active:   "text-green-400",
  archived: "text-white/40",
  pinned:   "text-yellow-400",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function successRate(t: SOTemplate): string {
  if (t.usage_count === 0) return "—";
  return `${Math.round((t.success_count / t.usage_count) * 100)}%`;
}

function SOTemplateCard({
  template,
  onArchive,
  onPin,
  onActivate,
  onDelete,
}: {
  template: SOTemplate;
  onArchive: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onActivate: (t: SOTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [executions, setExecutions] = useState<SOExecution[]>([]);
  const [loadingExecs, setLoadingExecs] = useState(false);

  async function loadExecutions() {
    if (executions.length > 0) return;
    setLoadingExecs(true);
    try {
      const { data } = await supabase
        .from("mavis_so_executions")
        .select("id,template_slug,status,result,error_message,turns_used,started_at,completed_at,triggered_by")
        .eq("template_id", template.id)
        .order("started_at", { ascending: false })
        .limit(5);
      setExecutions(data ?? []);
    } catch { /* non-critical */ } finally {
      setLoadingExecs(false);
    }
  }

  function toggleExpand() {
    if (!expanded) loadExecutions();
    setExpanded(!expanded);
  }

  return (
    <HudCard>
      <div className="flex items-start justify-between">
        <button onClick={toggleExpand} className="flex items-start gap-3 text-left flex-1 min-w-0">
          <div className="mt-0.5">
            {expanded ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-white">{template.name}</h3>
              <span className={`text-xs ${STATUS_COLORS[template.status]}`}>
                {template.status === "pinned" ? "★ Pinned" : template.status === "archived" ? "Archived" : "Active"}
              </span>
              {template.created_by_agent && (
                <span className="text-[10px] text-primary bg-primary/10 rounded px-1.5 py-0.5">AI-created</span>
              )}
              <span className="text-[10px] text-white/40 bg-white/5 rounded px-1.5 py-0.5 capitalize">{template.category}</span>
            </div>
            {template.description && (
              <p className="text-xs text-white/50 mt-0.5 line-clamp-1">{template.description}</p>
            )}
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/40">
              <span>v{template.version}</span>
              <span>Used {template.usage_count}×</span>
              <span>Success: {successRate(template)}</span>
              {template.last_used_at && <span>Last: {fmtDate(template.last_used_at)}</span>}
              {template.cron_expression && <span className="text-yellow-400/60">⏱ {template.cron_expression}</span>}
            </div>
          </div>
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-1 ml-3 flex-shrink-0">
          <button
            onClick={() => onActivate(template)}
            title="Run this template"
            className="p-1.5 hover:bg-primary/20 rounded text-primary/70 hover:text-primary transition-colors"
          >
            <Play size={13} />
          </button>
          <button
            onClick={() => onPin(template.id, template.status !== "pinned")}
            title={template.status === "pinned" ? "Unpin" : "Pin"}
            className={`p-1.5 rounded transition-colors ${
              template.status === "pinned"
                ? "text-yellow-400 hover:text-yellow-300 bg-yellow-400/10"
                : "text-white/40 hover:text-white/70 hover:bg-white/10"
            }`}
          >
            <Star size={13} />
          </button>
          {template.status !== "archived" && (
            <button
              onClick={() => onArchive(template.id)}
              title="Archive"
              className="p-1.5 hover:bg-white/10 rounded text-white/40 hover:text-white/70 transition-colors"
            >
              <Archive size={13} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mt-3 pt-3 border-t border-white/5"
          >
            <p className="text-xs text-white/40 mb-1">Instructions:</p>
            <pre className="text-xs text-white/70 bg-black/20 rounded p-2 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
              {template.instructions}
            </pre>

            {template.tags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {template.tags.map(t => (
                  <span key={t} className="text-[10px] text-white/40 bg-white/5 rounded px-1.5 py-0.5">#{t}</span>
                ))}
              </div>
            )}

            {/* Recent executions */}
            <div className="mt-3">
              <p className="text-xs text-white/40 mb-1.5">Recent Executions:</p>
              {loadingExecs ? (
                <div className="flex items-center gap-1.5 text-white/40 text-xs">
                  <Loader2 size={12} className="animate-spin" /> Loading...
                </div>
              ) : executions.length === 0 ? (
                <p className="text-xs text-white/30 italic">No executions yet</p>
              ) : (
                <div className="space-y-1">
                  {executions.map(e => (
                    <div key={e.id} className="flex items-center gap-2 text-[10px]">
                      {e.status === "completed"
                        ? <CheckCircle2 size={10} className="text-green-400" />
                        : e.status === "failed"
                        ? <XCircle size={10} className="text-red-400" />
                        : <Clock size={10} className="text-yellow-400" />
                      }
                      <span className="text-white/50">{fmtDate(e.started_at)}</span>
                      <span className="text-white/40">via {e.triggered_by}</span>
                      <span className="text-white/40">{e.turns_used} turns</span>
                      {e.status === "failed" && e.error_message && (
                        <span className="text-red-400/70 truncate max-w-[120px]">{e.error_message}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </HudCard>
  );
}

const EMPTY_FORM: CreateForm = { name: "", slug: "", description: "", instructions: "", category: "general", tags: "" };

export function StandingOrderTemplatesPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<SOTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | SOStatus>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [activating, setActivating] = useState<SOTemplate | null>(null);

  useEffect(() => {
    if (!user) return;
    loadTemplates();
  }, [user]);

  async function loadTemplates() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("standing_order_templates")
        .select("*")
        .eq("user_id", user!.id)
        .order("status", { ascending: false })
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setTemplates(data ?? []);
    } catch (e: any) {
      toast.error("Failed to load templates: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function createTemplate() {
    if (!form.name.trim() || !form.instructions.trim()) {
      toast.error("Name and instructions are required");
      return;
    }
    setCreating(true);
    try {
      const slug = form.slug.trim() || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const tags = form.tags.split(",").map(t => t.trim()).filter(Boolean);

      const { error } = await supabase.from("standing_order_templates").insert({
        user_id:      user!.id,
        slug,
        name:         form.name.trim(),
        description:  form.description.trim() || null,
        instructions: form.instructions.trim(),
        category:     form.category,
        tags,
      });

      if (error) throw error;
      toast.success("Template created!");
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await loadTemplates();
    } catch (e: any) {
      toast.error("Failed to create: " + e.message);
    } finally {
      setCreating(false);
    }
  }

  async function archiveTemplate(id: string) {
    try {
      await supabase.from("standing_order_templates").update({ status: "archived" }).eq("id", id);
      toast.success("Template archived");
      setTemplates(prev => prev.map(t => t.id === id ? { ...t, status: "archived" } : t));
    } catch (e: any) {
      toast.error("Failed: " + e.message);
    }
  }

  async function pinTemplate(id: string, pin: boolean) {
    const newStatus = pin ? "pinned" : "active";
    try {
      await supabase.from("standing_order_templates").update({ status: newStatus }).eq("id", id);
      setTemplates(prev => prev.map(t => t.id === id ? { ...t, status: newStatus as SOStatus } : t));
    } catch (e: any) {
      toast.error("Failed: " + e.message);
    }
  }

  async function activateTemplate(template: SOTemplate) {
    setActivating(template);
    // Increment usage count
    supabase.from("standing_order_templates").update({
      usage_count: (template.usage_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    }).eq("id", template.id).then(() => {});

    // Copy instructions to clipboard
    await navigator.clipboard.writeText(template.instructions);
    toast.success(`"${template.name}" instructions copied — paste into MAVIS chat to execute.`, { duration: 4000 });
    setTimeout(() => window.location.href = "/mavis", 1500);
  }

  const filtered = templates.filter(t => statusFilter === "all" || t.status === statusFilter);
  const pinned = filtered.filter(t => t.status === "pinned");
  const active = filtered.filter(t => t.status === "active");
  const archived = filtered.filter(t => t.status === "archived");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Standing Order Templates"
        subtitle="Reusable procedure templates with curator lifecycle. Archive = recoverable. Never deleted."
        icon={<FileText size={20} />}
        actions={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 text-xs bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={13} />
            New Template
          </button>
        }
      />

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {(["all", "active", "pinned", "archived"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize ${
              statusFilter === s
                ? "bg-primary/20 border-primary text-primary"
                : "border-white/20 text-white/60 hover:text-white hover:border-white/40"
            }`}
          >
            {s === "all" ? `All (${templates.length})` : `${s} (${templates.filter(t => t.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <HudCard className="border border-primary/20">
              <h3 className="text-sm font-semibold text-white mb-3">Create New Template</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Name *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Morning Review"
                      className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Category</label>
                    <select
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/40"
                    >
                      {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Description</label>
                  <input
                    type="text"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Brief description of what this template does"
                    className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/40"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Instructions * (the full procedure MAVIS will follow)</label>
                  <textarea
                    value={form.instructions}
                    onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                    placeholder="Step-by-step instructions for MAVIS to execute..."
                    rows={5}
                    className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-primary/40 resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1 block">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={form.tags}
                    onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                    placeholder="morning, review, daily"
                    className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/40"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setShowCreate(false)}
                  className="text-xs text-white/50 hover:text-white px-4 py-2 rounded border border-white/10 hover:border-white/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={createTemplate}
                  disabled={creating}
                  className="flex items-center gap-1.5 text-xs text-black font-semibold bg-primary hover:bg-primary/80 px-4 py-2 rounded transition-colors disabled:opacity-50"
                >
                  {creating ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save Template
                </button>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading templates...
        </div>
      )}

      {/* Templates list */}
      {!loading && (
        <div className="space-y-6">
          {/* Pinned */}
          {pinned.length > 0 && (
            <div>
              <h4 className="text-xs text-yellow-400/70 font-medium mb-2 uppercase tracking-wide">★ Pinned</h4>
              <div className="space-y-2">
                {pinned.map(t => (
                  <SOTemplateCard key={t.id} template={t} onArchive={archiveTemplate} onPin={pinTemplate} onActivate={activateTemplate} onDelete={() => {}} />
                ))}
              </div>
            </div>
          )}

          {/* Active */}
          {active.length > 0 && (
            <div>
              {pinned.length > 0 && <h4 className="text-xs text-white/40 font-medium mb-2 uppercase tracking-wide">Active</h4>}
              <div className="space-y-2">
                {active.map(t => (
                  <SOTemplateCard key={t.id} template={t} onArchive={archiveTemplate} onPin={pinTemplate} onActivate={activateTemplate} onDelete={() => {}} />
                ))}
              </div>
            </div>
          )}

          {/* Archived */}
          {archived.length > 0 && (
            <div>
              <h4 className="text-xs text-white/40 font-medium mb-2 uppercase tracking-wide">Archived (recoverable)</h4>
              <div className="space-y-2 opacity-70">
                {archived.map(t => (
                  <SOTemplateCard key={t.id} template={t} onArchive={archiveTemplate} onPin={pinTemplate} onActivate={activateTemplate} onDelete={() => {}} />
                ))}
              </div>
            </div>
          )}

          {templates.length === 0 && (
            <div className="text-center py-12 text-white/40">
              <FileText size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No templates yet.</p>
              <p className="text-xs mt-1">Create a template to save reusable MAVIS procedures.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 text-xs text-primary hover:text-primary/80 underline"
              >
                Create your first template
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
