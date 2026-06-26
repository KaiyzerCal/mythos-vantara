import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronRight, Loader2, BookOpen, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard, FieldError, fieldClass } from "@/components/SharedUI";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";

// ─── Types ────────────────────────────────────────────────────
interface TacitEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  source: string | null;
  confidence: number;
  updated_at: string;
}

interface KnowledgeEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  tags: string[] | null;
  updated_at: string;
}

const TACIT_CATEGORIES = ["preference", "hard_rule", "lesson_learned", "workflow_habit", "communication_style", "standing_order"];
const KNOWLEDGE_CATEGORIES = ["project", "area", "resource", "archive"];

const TACIT_LABELS: Record<string, { label: string; color: string }> = {
  preference:          { label: "Preference",   color: "text-blue-400 border-blue-500/30 bg-blue-900/20" },
  hard_rule:           { label: "Hard Rule",    color: "text-red-400 border-red-500/30 bg-red-900/20" },
  lesson_learned:      { label: "Lesson",       color: "text-amber-400 border-amber-500/30 bg-amber-900/20" },
  workflow_habit:      { label: "Habit",        color: "text-green-400 border-green-500/30 bg-green-900/20" },
  communication_style: { label: "Comms Style",  color: "text-purple-400 border-purple-500/30 bg-purple-900/20" },
  standing_order:      { label: "Standing Order", color: "text-primary border-primary/30 bg-primary/10" },
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round((value / 10) * 100);
  const color = value >= 8 ? "bg-green-500" : value >= 5 ? "bg-amber-500" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-6 text-right">{value}/10</span>
    </div>
  );
}

// ─── Tacit Layer ──────────────────────────────────────────────
function TacitSection({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<TacitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ key: "", value: "", category: "", confidence: 7 });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ key: "", value: "", category: "preference", confidence: 7 });
  const [createErrors, setCreateErrors] = useState<{ key?: string; value?: string }>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [filterCat, setFilterCat] = useState<string>("all");

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("mavis_tacit")
      .select("id,category,key,value,source,confidence,updated_at")
      .eq("user_id", userId)
      .order("category")
      .order("updated_at", { ascending: false });
    setEntries(data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    const errs: typeof createErrors = {};
    if (!createForm.key.trim()) errs.key = "Key is required";
    if (!createForm.value.trim()) errs.value = "Value is required";
    if (Object.keys(errs).length) { setCreateErrors(errs); return; }
    setCreateErrors({});
    setSaving(true);
    const { error } = await (supabase as any).from("mavis_tacit").upsert({
      user_id: userId,
      category: createForm.category,
      key: createForm.key.trim(),
      value: createForm.value.trim(),
      confidence: createForm.confidence,
      source: "manual",
    }, { onConflict: "user_id,key" });
    if (error) toast.error("Failed to save memory");
    else { toast.success("Memory saved"); setShowCreate(false); setCreateForm({ key: "", value: "", category: "preference", confidence: 7 }); await load(); }
    setSaving(false);
  }

  async function handleEdit(entry: TacitEntry) {
    setEditForm({ key: entry.key, value: entry.value, category: entry.category, confidence: entry.confidence });
    setEditingId(entry.id);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSaving(true);
    const { error } = await (supabase as any).from("mavis_tacit").update({
      key: editForm.key.trim(),
      value: editForm.value.trim(),
      category: editForm.category,
      confidence: editForm.confidence,
      updated_at: new Date().toISOString(),
    }).eq("id", editingId);
    if (error) toast.error("Failed to update");
    else { toast.success("Updated"); setEditingId(null); await load(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const { error } = await (supabase as any).from("mavis_tacit").delete().eq("id", id);
    if (error) toast.error("Failed to delete");
    else { toast.success("Memory removed"); setEntries(prev => prev.filter(e => e.id !== id)); }
    setConfirmDelete(null);
  }

  const filtered = filterCat === "all" ? entries : entries.filter(e => e.category === filterCat);

  if (loading) return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {["all", ...TACIT_CATEGORIES].map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
              filterCat === c ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}>
            {c === "all" ? "All" : TACIT_LABELS[c]?.label ?? c}
            {c !== "all" && <span className="ml-1 opacity-60">({entries.filter(e => e.category === c).length})</span>}
          </button>
        ))}
      </div>

      {/* Entries */}
      <AnimatePresence>
        {filtered.map(entry => {
          const tag = TACIT_LABELS[entry.category] ?? { label: entry.category, color: "text-muted-foreground border-border bg-muted/30" };
          const isEditing = editingId === entry.id;
          return (
            <motion.div key={entry.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="hud-border rounded-lg p-3 space-y-2 group">
              {isEditing ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editForm.key} onChange={e => setEditForm(f => ({ ...f, key: e.target.value }))}
                      className={fieldClass()} placeholder="Key" />
                    <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
                      className="bg-muted/30 border border-border rounded px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-primary/40">
                      {TACIT_CATEGORIES.map(c => <option key={c} value={c}>{TACIT_LABELS[c]?.label ?? c}</option>)}
                    </select>
                  </div>
                  <textarea value={editForm.value} onChange={e => setEditForm(f => ({ ...f, value: e.target.value }))}
                    rows={3} className={fieldClass()} placeholder="Value" />
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-mono text-muted-foreground whitespace-nowrap">Confidence: {editForm.confidence}/10</label>
                    <input type="range" min={1} max={10} value={editForm.confidence}
                      onChange={e => setEditForm(f => ({ ...f, confidence: Number(e.target.value) }))}
                      className="flex-1 accent-primary h-1" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} disabled={saving}
                      className="flex items-center gap-1 px-3 py-1 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all disabled:opacity-50">
                      {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs font-mono text-muted-foreground hover:text-foreground border border-border rounded transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded border shrink-0 ${tag.color}`}>{tag.label}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-foreground font-medium">{entry.key}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{entry.value}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => handleEdit(entry)} className="p-1 rounded text-muted-foreground hover:text-primary transition-colors">
                        <Edit2 size={11} />
                      </button>
                      <button onClick={() => setConfirmDelete({ id: entry.id, label: entry.key })} className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  <ConfidenceBar value={entry.confidence} />
                  {entry.source && <p className="text-xs text-muted-foreground">Source: {entry.source}</p>}
                </>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {!filtered.length && (
        <EmptyState
          icon={Brain}
          title={`No ${filterCat === "all" ? "" : filterCat + " "}memories yet`}
          description="MAVIS learns these from your conversations and behavior."
          action={{ label: "+ Add Memory", onClick: () => setShowCreate(true) }}
        />
      )}

      {/* Create */}
      {showCreate ? (
        <div className="hud-border rounded-lg p-3 space-y-2 border-primary/20">
          <p className="text-xs font-mono text-primary uppercase tracking-wider">Add Memory</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <input value={createForm.key} onChange={e => { setCreateForm(f => ({ ...f, key: e.target.value })); if (createErrors.key) setCreateErrors(p => ({ ...p, key: undefined })); }}
                placeholder="Key (e.g. preferred_tone)" className={fieldClass(!!createErrors.key)} />
              <FieldError message={createErrors.key} />
            </div>
            <select value={createForm.category} onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
              className="bg-muted/30 border border-border rounded px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-primary/40">
              {TACIT_CATEGORIES.map(c => <option key={c} value={c}>{TACIT_LABELS[c]?.label ?? c}</option>)}
            </select>
          </div>
          <div>
            <textarea value={createForm.value} onChange={e => { setCreateForm(f => ({ ...f, value: e.target.value })); if (createErrors.value) setCreateErrors(p => ({ ...p, value: undefined })); }}
              rows={3} placeholder="Value (e.g. direct and confident, never passive)" className={fieldClass(!!createErrors.value)} />
            <FieldError message={createErrors.value} />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-mono text-muted-foreground whitespace-nowrap">Confidence: {createForm.confidence}/10</label>
            <input type="range" min={1} max={10} value={createForm.confidence}
              onChange={e => setCreateForm(f => ({ ...f, confidence: Number(e.target.value) }))}
              className="flex-1 accent-primary h-1" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-all disabled:opacity-50">
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Save Memory
            </button>
            <button onClick={() => { setShowCreate(false); setCreateErrors({}); }} className="px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground border border-border rounded transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowCreate(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-mono text-muted-foreground hover:text-primary border border-dashed border-border hover:border-primary/40 rounded transition-all">
          <Plus size={10} /> Add memory manually
        </button>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Remove Memory"
        description={`Remove "${confirmDelete?.label}" from MAVIS's tacit knowledge?`}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ─── Knowledge Layer ──────────────────────────────────────────
function KnowledgeSection({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState("all");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("mavis_knowledge")
      .select("id,category,title,content,tags,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    setEntries(data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    await (supabase as any).from("mavis_knowledge").delete().eq("id", id);
    setEntries(prev => prev.filter(e => e.id !== id));
    setConfirmDelete(null);
    toast.success("Entry removed");
  }

  const filtered = filterCat === "all" ? entries : entries.filter(e => e.category === filterCat);

  if (loading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {["all", ...KNOWLEDGE_CATEGORIES].map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors capitalize ${
              filterCat === c ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}>{c === "all" ? "All" : c}</button>
        ))}
      </div>

      {filtered.map(entry => (
        <div key={entry.id} className="hud-border rounded-lg overflow-hidden group">
          <button onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors text-left">
            {expanded === entry.id ? <ChevronDown size={12} className="text-muted-foreground shrink-0" /> : <ChevronRight size={12} className="text-muted-foreground shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-foreground">{entry.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-mono text-primary/70 capitalize">{entry.category}</span>
                {(entry.tags ?? []).slice(0, 2).map(t => <span key={t} className="text-xs text-muted-foreground">#{t}</span>)}
              </div>
            </div>
            <button onClick={e => { e.stopPropagation(); setConfirmDelete({ id: entry.id, label: entry.title }); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all shrink-0">
              <Trash2 size={10} />
            </button>
          </button>
          <AnimatePresence>
            {expanded === entry.id && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                className="overflow-hidden border-t border-border/50">
                <p className="px-3 py-2.5 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {entry.content}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}

      {!filtered.length && (
        <EmptyState
          icon={BookOpen}
          title="No knowledge entries yet"
          description="MAVIS builds your knowledge base through conversations."
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Remove Knowledge Entry"
        description={`Remove "${confirmDelete?.label}"?`}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ─── MemoryPage ───────────────────────────────────────────────
export default function MemoryPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"tacit" | "knowledge">("tacit");

  if (!user) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="MAVIS Memory"
        subtitle="What MAVIS knows about you — view, correct, and teach"
        icon={<Brain size={18} />}
      />

      <div className="flex gap-1">
        {([
          { key: "tacit", label: "Tacit Knowledge", icon: Layers, desc: "Preferences, rules, habits" },
          { key: "knowledge", label: "Knowledge Base", icon: BookOpen, desc: "Projects, resources, context" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded border text-left transition-all ${
              tab === t.key ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}>
            <t.icon size={13} className="shrink-0" />
            <div>
              <p className="text-xs font-mono font-medium">{t.label}</p>
              <p className="text-xs text-muted-foreground">{t.desc}</p>
            </div>
          </button>
        ))}
      </div>

      <HudCard>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {tab === "tacit"
              ? <TacitSection userId={user.id} />
              : <KnowledgeSection userId={user.id} />
            }
          </motion.div>
        </AnimatePresence>
      </HudCard>
    </div>
  );
}
