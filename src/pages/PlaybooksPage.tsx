// ============================================================
// VANTARA.EXE — PlaybooksPage
// Domain procedure libraries: Finance, Research, Creative, Health
// Inspired by Hermes optional-skills domain templates.
// ============================================================
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, ChevronDown, ChevronRight, Play, Zap, Search,
  DollarSign, FlaskConical, Palette, Heart, Plus, Copy, Check, Trash2,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface Procedure {
  name: string;
  description: string;
  prompt_template: string;
  tags?: string[];
}

interface Playbook {
  id: string;
  slug: string;
  name: string;
  domain: string;
  description: string;
  procedures: Procedure[];
  is_system: boolean;
  is_active: boolean;
  usage_count: number;
  tags: string[];
  created_at: string;
}

const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  finance:  <DollarSign size={18} />,
  research: <Search size={18} />,
  creative: <Palette size={18} />,
  health:   <Heart size={18} />,
  custom:   <Zap size={18} />,
};

const DOMAIN_COLORS: Record<string, string> = {
  finance:  "text-green-400 border-green-400/30 bg-green-400/5",
  research: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  creative: "text-purple-400 border-purple-400/30 bg-purple-400/5",
  health:   "text-rose-400 border-rose-400/30 bg-rose-400/5",
  custom:   "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
};

function fmtTemplate(template: string): string {
  return template.replace(/\{(\w+)\}/g, "[$1]");
}

function ProcedureCard({ proc, onActivate }: { proc: Procedure; onActivate: (proc: Procedure) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyTemplate() {
    await navigator.clipboard.writeText(proc.prompt_template);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Template copied — fill in the [brackets] and paste into MAVIS chat");
  }

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors"
      >
        <div>
          <p className="text-sm font-medium text-white">{proc.name}</p>
          <p className="text-xs text-white/50 mt-0.5">{proc.description}</p>
        </div>
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {proc.tags?.slice(0, 2).map(t => (
            <span key={t} className="text-xs text-white/40 bg-white/5 rounded px-1.5 py-0.5">{t}</span>
          ))}
          {expanded ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t border-white/5">
              <p className="text-xs text-white/40 mt-2 mb-1">Prompt Template (fill in [brackets]):</p>
              <pre className="text-xs text-white/70 bg-black/20 rounded p-2 whitespace-pre-wrap font-mono leading-relaxed">
                {fmtTemplate(proc.prompt_template)}
              </pre>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={copyTemplate}
                  className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded px-2 py-1 transition-colors"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied!" : "Copy template"}
                </button>
                <button
                  onClick={() => onActivate(proc)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 rounded px-2 py-1 transition-colors"
                >
                  <Play size={12} />
                  Activate in MAVIS chat
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlaybookCard({
  playbook,
  onActivate,
  onDelete,
}: {
  playbook: Playbook;
  onActivate: (proc: Procedure, playbook: Playbook) => void;
  onDelete: (playbook: Playbook) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = DOMAIN_COLORS[playbook.domain] ?? DOMAIN_COLORS.custom;

  return (
    <HudCard className={`border ${colorClass}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`${colorClass} p-2 rounded-lg border`}>
            {DOMAIN_ICONS[playbook.domain] ?? <BookOpen size={18} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{playbook.name}</h3>
              {playbook.is_system && (
                <span className="text-xs text-white/40 bg-white/5 rounded px-1.5 py-0.5 uppercase tracking-wide">System</span>
              )}
            </div>
            <p className="text-xs text-white/50 mt-0.5">{playbook.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          <span className="text-xs text-white/40">{playbook.procedures.length} procedures</span>
          {!playbook.is_system && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(playbook);
              }}
              className="p-1 text-white/30 hover:text-red-400 transition-colors rounded"
              title="Delete playbook"
            >
              <Trash2 size={13} />
            </button>
          )}
          {expanded ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mt-3"
          >
            <div className="space-y-2">
              {playbook.procedures.map((proc, i) => (
                <ProcedureCard key={i} proc={proc} onActivate={(p) => onActivate(p, playbook)} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </HudCard>
  );
}

const DOMAIN_FILTERS = ["all", "finance", "research", "creative", "health", "custom"];

export function PlaybooksPage() {
  const { user } = useAuth();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [activatingProc, setActivatingProc] = useState<{ proc: Procedure; playbook: Playbook } | null>(null);
  const [filledTemplate, setFilledTemplate] = useState("");

  // New Playbook form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDomain, setNewDomain] = useState("custom");
  const [newDescription, setNewDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Playbook | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadPlaybooks();
  }, [user]);

  async function loadPlaybooks() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("mavis_playbooks")
        .select("*")
        .eq("is_active", true)
        .order("domain", { ascending: true });

      if (error) throw error;
      setPlaybooks((data ?? []).map((p: any) => ({
        ...p,
        procedures: Array.isArray(p.procedures) ? p.procedures : [],
      })));
    } catch (e: any) {
      toast.error("Failed to load playbooks: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function activatePlaybook(proc: Procedure, playbook: Playbook) {
    setActivatingProc({ proc, playbook });
    setFilledTemplate(fmtTemplate(proc.prompt_template));

    // Increment usage count (non-blocking)
    supabase.from("mavis_playbooks").update({ usage_count: (playbook.usage_count ?? 0) + 1 }).eq("id", playbook.id).then(() => {});
  }

  async function copyAndNavigate() {
    if (!activatingProc) return;
    await navigator.clipboard.writeText(filledTemplate);
    toast.success("Copied! Paste into MAVIS chat to activate this procedure.", { duration: 4000 });
    setActivatingProc(null);
    // Navigate to MAVIS chat
    window.location.href = "/mavis";
  }

  async function handleCreate() {
    if (!newName.trim()) {
      toast.error("Playbook name is required.");
      return;
    }
    setSaving(true);
    try {
      const slug = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const { error } = await supabase.from("mavis_playbooks").insert({
        name: newName.trim(),
        slug,
        domain: newDomain,
        description: newDescription.trim() || null,
        procedures: [],
        is_system: false,
        is_active: true,
        usage_count: 0,
        tags: [],
      });
      if (error) throw error;
      toast.success("Playbook created!");
      setShowCreateForm(false);
      setNewName("");
      setNewDomain("custom");
      setNewDescription("");
      await loadPlaybooks();
    } catch (e: any) {
      toast.error("Failed to create playbook: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("mavis_playbooks")
        .delete()
        .eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success(`"${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      await loadPlaybooks();
    } catch (e: any) {
      toast.error("Failed to delete playbook: " + e.message);
    } finally {
      setDeleting(false);
    }
  }

  const filtered = filter === "all"
    ? playbooks
    : playbooks.filter(p => p.domain === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Domain Playbooks"
          subtitle="Structured procedure libraries for Finance, Research, Creative, and Health domains."
          icon={<BookOpen size={20} />}
        />
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-black bg-primary hover:bg-primary/80 px-3 py-2 rounded-lg transition-colors whitespace-nowrap mt-1"
        >
          <Plus size={14} />
          New Playbook
        </button>
      </div>

      {/* Create playbook inline form */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border border-primary/30 bg-primary/5 rounded-xl p-5 space-y-4">
              <p className="text-sm font-semibold text-white">Create New Playbook</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-white/50">Name <span className="text-primary">*</span></label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Investment Research"
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/40"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-white/50">Domain</label>
                  <select
                    value={newDomain}
                    onChange={e => setNewDomain(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/40"
                  >
                    {DOMAIN_FILTERS.filter(d => d !== "all").map(d => (
                      <option key={d} value={d} className="bg-[#0d1025] capitalize">{d}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-white/50">Description <span className="text-white/30">(optional)</span></label>
                <textarea
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="Brief description of this playbook's purpose…"
                  rows={2}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/40 resize-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewName("");
                    setNewDomain("custom");
                    setNewDescription("");
                  }}
                  className="text-xs text-white/50 hover:text-white px-4 py-2 rounded border border-white/10 hover:border-white/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-xs text-black font-semibold bg-primary hover:bg-primary/80 disabled:opacity-50 px-4 py-2 rounded transition-colors"
                >
                  {saving ? (
                    <div className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : (
                    <Plus size={12} />
                  )}
                  {saving ? "Saving…" : "Create Playbook"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Domain filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {DOMAIN_FILTERS.map(d => (
          <button
            key={d}
            onClick={() => setFilter(d)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize ${
              filter === d
                ? "bg-primary/20 border-primary text-primary"
                : "border-white/20 text-white/60 hover:text-white hover:border-white/40"
            }`}
          >
            {d === "all" ? "All Domains" : d}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          Loading playbooks...
        </div>
      )}

      {/* Playbooks grid */}
      {!loading && (
        <div className="space-y-4">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-white/40">
              <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
              <p>No playbooks in this domain yet.</p>
              <button
                onClick={() => {
                  setNewDomain(filter !== "all" ? filter : "custom");
                  setShowCreateForm(true);
                }}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-black bg-primary hover:bg-primary/80 px-4 py-2 rounded-lg transition-colors"
              >
                <Plus size={13} />
                Create Playbook
              </button>
            </div>
          ) : (
            filtered.map(pb => (
              <PlaybookCard
                key={pb.id}
                playbook={pb}
                onActivate={activatePlaybook}
                onDelete={(pb) => setDeleteTarget(pb)}
              />
            ))
          )}
        </div>
      )}

      {/* Procedure activation modal */}
      <AnimatePresence>
        {activatingProc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setActivatingProc(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#0d1025] border border-white/20 rounded-xl p-5 w-full max-w-lg shadow-2xl"
            >
              <h3 className="text-base font-semibold text-white mb-1">{activatingProc.proc.name}</h3>
              <p className="text-xs text-white/50 mb-4">{activatingProc.playbook.name} · {activatingProc.proc.description}</p>

              <p className="text-xs text-white/40 mb-2">Fill in the [brackets] below, then activate:</p>
              <textarea
                value={filledTemplate}
                onChange={e => setFilledTemplate(e.target.value)}
                rows={8}
                className="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-white/80 font-mono resize-none focus:outline-none focus:border-primary/40"
              />

              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setActivatingProc(null)}
                  className="text-xs text-white/50 hover:text-white px-4 py-2 rounded border border-white/10 hover:border-white/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={copyAndNavigate}
                  className="flex items-center gap-1.5 text-xs text-black font-semibold bg-primary hover:bg-primary/80 px-4 py-2 rounded transition-colors"
                >
                  <Play size={12} />
                  Copy & Open MAVIS
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This playbook and all its procedures will be permanently removed. This action cannot be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        danger
      />
    </div>
  );
}
