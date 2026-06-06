// ============================================================
// VANTARA.EXE — SystemSettingsPage
// Standing Orders · Custom Skills · LLM Analytics
// ============================================================
import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Trash2,
  Plus,
  Pencil,
  Check,
  X,
  BarChart2,
  BookOpen,
  Wrench,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

// ─── Types ───────────────────────────────────────────────────

type TacitCategory =
  | "hard_rule"
  | "correction"
  | "preference"
  | "lesson_learned"
  | "workflow_habit";

interface TacitEntry {
  id: string;
  key: string;
  value: string;
  confidence: number;
  category: TacitCategory;
  user_id: string;
  created_at: string;
}

interface CustomSkill {
  id: string;
  name: string;
  description: string | null;
  trigger_phrase: string | null;
  system_prompt: string | null;
  modes: string[] | null;
  enabled: boolean;
  user_id: string;
  created_at: string;
}

interface LlmCall {
  id: string;
  provider: string | null;
  mode: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  success: boolean | null;
  created_at: string;
}

interface AnalyticsRow {
  provider: string;
  mode: string;
  calls: number;
  avg_latency: number;
  success_rate: number;
  total_cost: number;
}

// ─── Constants ───────────────────────────────────────────────

const TACIT_CATEGORIES: TacitCategory[] = [
  "hard_rule",
  "correction",
  "preference",
  "lesson_learned",
  "workflow_habit",
];

const CATEGORY_STYLES: Record<TacitCategory, string> = {
  hard_rule: "bg-red-900/40 text-red-300 border-red-700",
  correction: "bg-amber-900/40 text-amber-300 border-amber-700",
  preference: "bg-blue-900/40 text-blue-300 border-blue-700",
  lesson_learned: "bg-purple-900/40 text-purple-300 border-purple-700",
  workflow_habit: "bg-green-900/40 text-green-300 border-green-700",
};

const CATEGORY_LABEL: Record<TacitCategory, string> = {
  hard_rule: "Hard Rule",
  correction: "Correction",
  preference: "Preference",
  lesson_learned: "Lesson Learned",
  workflow_habit: "Workflow Habit",
};

const ALL_MODES = [
  "PRIME",
  "ARCH",
  "QUEST",
  "FORGE",
  "CODEX",
  "SOVEREIGN",
  "AGENT",
  "RESEARCH",
];

// ─── Helpers ────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtUsd(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(3)}¢`;
  return `$${usd.toFixed(4)}`;
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ─── CategoryBadge ──────────────────────────────────────────

function CategoryBadge({ cat }: { cat: TacitCategory }) {
  return (
    <span
      className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${CATEGORY_STYLES[cat]}`}
    >
      {CATEGORY_LABEL[cat]}
    </span>
  );
}

// ─── ConfidenceBar ──────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 80
      ? "bg-green-400"
      : pct >= 50
      ? "bg-amber-400"
      : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
        {(value).toFixed(2)}
      </span>
    </div>
  );
}

// ============================================================
// TAB 1 — Standing Orders (mavis_tacit)
// ============================================================

function StandingOrdersTab() {
  const { user } = useAuth();

  const [entries, setEntries] = useState<TacitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  // inline-edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<TacitEntry>>({});
  const [saving, setSaving] = useState(false);

  // add-form state
  const [showAdd, setShowAdd] = useState(false);
  const [newCat, setNewCat] = useState<TacitCategory>("preference");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newConfidence, setNewConfidence] = useState(0.8);
  const [adding, setAdding] = useState(false);

  // collapsed categories
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("mavis_tacit")
      .select("*")
      .eq("user_id", user.id)
      .order("category")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load standing orders");
    } else {
      setEntries((data ?? []) as TacitEntry[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Group by category ─────────────────────────────────────
  const grouped = TACIT_CATEGORIES.reduce<Record<TacitCategory, TacitEntry[]>>(
    (acc, cat) => {
      acc[cat] = entries.filter((e) => e.category === cat);
      return acc;
    },
    {} as Record<TacitCategory, TacitEntry[]>
  );

  // ── Delete ────────────────────────────────────────────────
  async function handleDelete(id: string) {
    setDeleting(id);
    const { error } = await (supabase as any)
      .from("mavis_tacit")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Delete failed");
    } else {
      toast.success("Entry removed");
      setEntries((prev) => prev.filter((e) => e.id !== id));
    }
    setDeleting(null);
  }

  // ── Start edit ────────────────────────────────────────────
  function startEdit(entry: TacitEntry) {
    setEditingId(entry.id);
    setEditDraft({
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
      category: entry.category,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  // ── Save edit ─────────────────────────────────────────────
  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("mavis_tacit")
      .update({
        key: editDraft.key,
        value: editDraft.value,
        confidence: editDraft.confidence,
        category: editDraft.category,
      })
      .eq("id", editingId);

    if (error) {
      toast.error("Save failed");
    } else {
      toast.success("Entry updated");
      setEntries((prev) =>
        prev.map((e) =>
          e.id === editingId ? { ...e, ...(editDraft as TacitEntry) } : e
        )
      );
      cancelEdit();
    }
    setSaving(false);
  }

  // ── Add new ───────────────────────────────────────────────
  async function handleAdd() {
    if (!user) return;
    if (!newKey.trim() || !newValue.trim()) {
      toast.error("Key and Value are required");
      return;
    }
    setAdding(true);
    const { data, error } = await (supabase as any)
      .from("mavis_tacit")
      .insert({
        user_id: user.id,
        category: newCat,
        key: newKey.trim(),
        value: newValue.trim(),
        confidence: newConfidence,
      })
      .select()
      .single();

    if (error) {
      toast.error("Failed to add entry");
    } else {
      toast.success("Standing order added");
      setEntries((prev) => [data as TacitEntry, ...prev]);
      setNewKey("");
      setNewValue("");
      setNewConfidence(0.8);
      setNewCat("preference");
      setShowAdd(false);
    }
    setAdding(false);
  }

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-muted-foreground">
          Persistent instructions MAVIS applies tacitly in every session.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="text-xs font-mono gap-1.5"
          onClick={() => setShowAdd((v) => !v)}
        >
          <Plus size={12} />
          {showAdd ? "Cancel" : "Add Order"}
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <HudCard glowColor="gold">
          <p className="text-[10px] font-mono text-primary uppercase tracking-widest mb-3">
            New Standing Order
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
                Category
              </label>
              <Select
                value={newCat}
                onValueChange={(v) => setNewCat(v as TacitCategory)}
              >
                <SelectTrigger className="text-xs font-mono h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TACIT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs font-mono">
                      {CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
                Key
              </label>
              <Input
                className="text-xs font-mono h-8"
                placeholder="e.g. response_length"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
              Value
            </label>
            <Textarea
              className="text-xs font-mono resize-none"
              rows={3}
              placeholder="Describe the standing order…"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
            />
          </div>
          <div className="mb-4">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 block">
              Confidence — {newConfidence.toFixed(2)}
            </label>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[newConfidence]}
              onValueChange={([v]) => setNewConfidence(v)}
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs font-mono"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs font-mono gap-1.5"
              onClick={handleAdd}
              disabled={adding}
            >
              {adding && <Loader2 size={11} className="animate-spin" />}
              Save Order
            </Button>
          </div>
        </HudCard>
      )}

      {/* Entries */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {TACIT_CATEGORIES.map((cat) => {
            const catEntries = grouped[cat];
            if (catEntries.length === 0) return null;
            const isCollapsed = collapsed[cat];

            return (
              <section key={cat}>
                {/* Category header */}
                <button
                  className="flex items-center gap-2 mb-2 w-full text-left"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))
                  }
                >
                  <CategoryBadge cat={cat} />
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {catEntries.length} {catEntries.length === 1 ? "entry" : "entries"}
                  </span>
                  {isCollapsed ? (
                    <ChevronDown size={12} className="ml-auto text-muted-foreground" />
                  ) : (
                    <ChevronUp size={12} className="ml-auto text-muted-foreground" />
                  )}
                </button>

                {!isCollapsed && (
                  <div className="space-y-2">
                    {catEntries.map((entry) => {
                      const isEditing = editingId === entry.id;
                      return (
                        <HudCard key={entry.id} glowColor="none">
                          {isEditing ? (
                            /* Edit mode */
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 block">
                                    Category
                                  </label>
                                  <Select
                                    value={editDraft.category}
                                    onValueChange={(v) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        category: v as TacitCategory,
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="text-xs font-mono h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {TACIT_CATEGORIES.map((c) => (
                                        <SelectItem
                                          key={c}
                                          value={c}
                                          className="text-xs font-mono"
                                        >
                                          {CATEGORY_LABEL[c]}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 block">
                                    Key
                                  </label>
                                  <Input
                                    className="text-xs font-mono h-8"
                                    value={editDraft.key ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({ ...d, key: e.target.value }))
                                    }
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1 block">
                                  Value
                                </label>
                                <Textarea
                                  className="text-xs font-mono resize-none"
                                  rows={3}
                                  value={editDraft.value ?? ""}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({ ...d, value: e.target.value }))
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 block">
                                  Confidence — {(editDraft.confidence ?? 0).toFixed(2)}
                                </label>
                                <Slider
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  value={[editDraft.confidence ?? 0]}
                                  onValueChange={([v]) =>
                                    setEditDraft((d) => ({ ...d, confidence: v }))
                                  }
                                  className="w-full"
                                />
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-xs font-mono gap-1"
                                  onClick={cancelEdit}
                                >
                                  <X size={11} />
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  className="text-xs font-mono gap-1"
                                  onClick={saveEdit}
                                  disabled={saving}
                                >
                                  {saving ? (
                                    <Loader2 size={11} className="animate-spin" />
                                  ) : (
                                    <Check size={11} />
                                  )}
                                  Save
                                </Button>
                              </div>
                            </div>
                          ) : (
                            /* View mode */
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="text-sm font-mono text-foreground">
                                    {entry.key}
                                  </span>
                                  <CategoryBadge cat={entry.category} />
                                </div>
                                <p className="text-xs font-mono text-muted-foreground leading-relaxed mb-2">
                                  {entry.value}
                                </p>
                                <ConfidenceBar value={entry.confidence} />
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => startEdit(entry)}
                                  className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-all"
                                  title="Edit"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  onClick={() => setConfirmDelete({ id: entry.id, label: entry.key })}
                                  disabled={deleting === entry.id}
                                  className="p-1.5 rounded hover:bg-red-900/30 text-muted-foreground hover:text-red-400 transition-all disabled:opacity-40"
                                  title="Delete"
                                >
                                  {deleting === entry.id ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={12} />
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </HudCard>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}

          {entries.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen size={24} className="mx-auto mb-3 opacity-30" />
              <p className="text-xs font-mono">No standing orders yet.</p>
              <p className="text-[10px] font-mono mt-1 opacity-60">
                Add your first entry above.
              </p>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          await handleDelete(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ============================================================
// TAB 2 — Custom Skills (mavis_custom_skills)
// ============================================================

const EMPTY_SKILL: Omit<CustomSkill, "id" | "user_id" | "created_at"> = {
  name: "",
  description: "",
  trigger_phrase: "",
  system_prompt: "",
  modes: [],
  enabled: true,
};

function ModePill({
  mode,
  selected,
  onToggle,
}: {
  mode: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-widest border transition-all ${
        selected
          ? "bg-primary/20 border-primary/50 text-primary"
          : "bg-muted/20 border-border text-muted-foreground hover:border-border/60"
      }`}
    >
      {mode}
    </button>
  );
}

function SkillForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: Omit<CustomSkill, "id" | "user_id" | "created_at">;
  onSave: (draft: Omit<CustomSkill, "id" | "user_id" | "created_at">) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(initial);

  function toggleMode(mode: string) {
    setDraft((d) => {
      const modes = d.modes ?? [];
      return {
        ...d,
        modes: modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode],
      };
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
            Name
          </label>
          <Input
            className="text-xs font-mono h-8"
            placeholder="My Skill"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
            Trigger Phrase
          </label>
          <Input
            className="text-xs font-mono h-8"
            placeholder="/my-skill or keyword"
            value={draft.trigger_phrase ?? ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, trigger_phrase: e.target.value }))
            }
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
          Description
        </label>
        <Input
          className="text-xs font-mono h-8"
          placeholder="Short description of what this skill does"
          value={draft.description ?? ""}
          onChange={(e) =>
            setDraft((d) => ({ ...d, description: e.target.value }))
          }
        />
      </div>
      <div>
        <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 block">
          System Prompt
        </label>
        <Textarea
          className="text-xs font-mono resize-none"
          rows={5}
          placeholder="You are a specialized assistant that…"
          value={draft.system_prompt ?? ""}
          onChange={(e) =>
            setDraft((d) => ({ ...d, system_prompt: e.target.value }))
          }
        />
      </div>
      <div>
        <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 block">
          Active Modes
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_MODES.map((m) => (
            <ModePill
              key={m}
              mode={m}
              selected={(draft.modes ?? []).includes(m)}
              onToggle={() => toggleMode(m)}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={draft.enabled}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
        />
        <span className="text-xs font-mono text-muted-foreground">
          {draft.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="ghost"
          className="text-xs font-mono gap-1"
          onClick={onCancel}
        >
          <X size={11} />
          Cancel
        </Button>
        <Button
          size="sm"
          className="text-xs font-mono gap-1"
          onClick={() => onSave(draft)}
          disabled={saving}
        >
          {saving && <Loader2 size={11} className="animate-spin" />}
          <Check size={11} />
          Save Skill
        </Button>
      </div>
    </div>
  );
}

function CustomSkillsTab() {
  const { user } = useAuth();

  const [skills, setSkills] = useState<CustomSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmDeleteSkill, setConfirmDeleteSkill] = useState<{ id: string; label: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [savingNew, setSavingNew] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("mavis_custom_skills")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load custom skills");
    } else {
      setSkills((data ?? []) as CustomSkill[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Toggle enabled ────────────────────────────────────────
  async function handleToggle(skill: CustomSkill) {
    setToggling(skill.id);
    const { error } = await (supabase as any)
      .from("mavis_custom_skills")
      .update({ enabled: !skill.enabled })
      .eq("id", skill.id);

    if (error) {
      toast.error("Toggle failed");
    } else {
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, enabled: !skill.enabled } : s))
      );
    }
    setToggling(null);
  }

  // ── Delete ────────────────────────────────────────────────
  async function handleDelete(id: string) {
    setDeleting(id);
    const { error } = await (supabase as any)
      .from("mavis_custom_skills")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Delete failed");
    } else {
      toast.success("Skill removed");
      setSkills((prev) => prev.filter((s) => s.id !== id));
    }
    setDeleting(null);
  }

  // ── Save edit ─────────────────────────────────────────────
  async function handleSaveEdit(
    id: string,
    draft: Omit<CustomSkill, "id" | "user_id" | "created_at">
  ) {
    setSavingEdit(true);
    const { error } = await (supabase as any)
      .from("mavis_custom_skills")
      .update(draft)
      .eq("id", id);

    if (error) {
      toast.error("Save failed");
    } else {
      toast.success("Skill updated");
      setSkills((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...draft } : s))
      );
      setEditingId(null);
    }
    setSavingEdit(false);
  }

  // ── Add new ───────────────────────────────────────────────
  async function handleAdd(
    draft: Omit<CustomSkill, "id" | "user_id" | "created_at">
  ) {
    if (!user) return;
    if (!draft.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSavingNew(true);
    const { data, error } = await (supabase as any)
      .from("mavis_custom_skills")
      .insert({ ...draft, user_id: user.id })
      .select()
      .single();

    if (error) {
      toast.error("Failed to add skill");
    } else {
      toast.success("Custom skill created");
      setSkills((prev) => [data as CustomSkill, ...prev]);
      setShowAdd(false);
    }
    setSavingNew(false);
  }

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-muted-foreground">
          Custom behaviors MAVIS can invoke via trigger phrase or mode context.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="text-xs font-mono gap-1.5"
          onClick={() => {
            setShowAdd((v) => !v);
            setEditingId(null);
          }}
        >
          <Plus size={12} />
          {showAdd ? "Cancel" : "New Skill"}
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <HudCard glowColor="gold">
          <p className="text-[10px] font-mono text-primary uppercase tracking-widest mb-3">
            New Custom Skill
          </p>
          <SkillForm
            initial={{ ...EMPTY_SKILL }}
            onSave={handleAdd}
            onCancel={() => setShowAdd(false)}
            saving={savingNew}
          />
        </HudCard>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) =>
            editingId === skill.id ? (
              <HudCard key={skill.id} glowColor="purple">
                <p className="text-[10px] font-mono text-purple-400 uppercase tracking-widest mb-3">
                  Edit Skill
                </p>
                <SkillForm
                  initial={{
                    name: skill.name,
                    description: skill.description,
                    trigger_phrase: skill.trigger_phrase,
                    system_prompt: skill.system_prompt,
                    modes: skill.modes,
                    enabled: skill.enabled,
                  }}
                  onSave={(draft) => handleSaveEdit(skill.id, draft)}
                  onCancel={() => setEditingId(null)}
                  saving={savingEdit}
                />
              </HudCard>
            ) : (
              <HudCard key={skill.id} glowColor={skill.enabled ? "green" : "none"}>
                <div className="flex items-start gap-3">
                  {/* Toggle */}
                  <div className="pt-0.5 shrink-0">
                    <Switch
                      checked={skill.enabled}
                      onCheckedChange={() => handleToggle(skill)}
                      disabled={toggling === skill.id}
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-mono text-foreground">
                        {skill.name}
                      </span>
                      {skill.trigger_phrase && (
                        <code className="text-[10px] font-mono bg-muted/40 border border-border px-1.5 py-0.5 rounded text-muted-foreground">
                          {skill.trigger_phrase}
                        </code>
                      )}
                      {!skill.enabled && (
                        <Badge variant="outline" className="text-[9px] font-mono">
                          Disabled
                        </Badge>
                      )}
                    </div>
                    {skill.description && (
                      <p className="text-xs font-mono text-muted-foreground mb-1.5">
                        {skill.description}
                      </p>
                    )}
                    {skill.modes && skill.modes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {skill.modes.map((m) => (
                          <span
                            key={m}
                            className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border bg-primary/10 border-primary/30 text-primary"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(skill.id);
                        setShowAdd(false);
                      }}
                      className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-all"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteSkill({ id: skill.id, label: skill.name })}
                      disabled={deleting === skill.id}
                      className="p-1.5 rounded hover:bg-red-900/30 text-muted-foreground hover:text-red-400 transition-all disabled:opacity-40"
                      title="Delete"
                    >
                      {deleting === skill.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                    </button>
                  </div>
                </div>
              </HudCard>
            )
          )}

          {skills.length === 0 && !showAdd && (
            <div className="text-center py-12 text-muted-foreground">
              <Wrench size={24} className="mx-auto mb-3 opacity-30" />
              <p className="text-xs font-mono">No custom skills yet.</p>
              <p className="text-[10px] font-mono mt-1 opacity-60">
                Create your first skill above.
              </p>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteSkill !== null}
        title={`Delete skill "${confirmDeleteSkill?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDeleteSkill) return;
          await handleDelete(confirmDeleteSkill.id);
          setConfirmDeleteSkill(null);
        }}
        onCancel={() => setConfirmDeleteSkill(null)}
      />
    </div>
  );
}

// ============================================================
// TAB 3 — LLM Analytics (mavis_llm_calls)
// ============================================================

function AnalyticsSummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="hud-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
        {label}
      </span>
      <span className="text-xl font-display font-bold text-foreground tabular-nums">
        {value}
      </span>
      {sub && (
        <span className="text-[10px] font-mono text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}

function LlmAnalyticsTab() {
  const { user } = useAuth();

  const [rows, setRows] = useState<LlmCall[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const since = new Date();
    since.setDate(since.getDate() - 7);

    const { data, error } = await (supabase as any)
      .from("mavis_llm_calls")
      .select("id, provider, mode, latency_ms, cost_usd, success, created_at")
      .eq("user_id", user.id)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load analytics");
    } else {
      setRows((data ?? []) as LlmCall[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Derived stats ─────────────────────────────────────────
  const totalCalls = rows.length;
  const avgLatency =
    totalCalls > 0
      ? rows.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / totalCalls
      : 0;
  const totalCost = rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0);

  // most used provider
  const providerCount: Record<string, number> = {};
  for (const r of rows) {
    const p = r.provider ?? "unknown";
    providerCount[p] = (providerCount[p] ?? 0) + 1;
  }
  const mostUsedProvider =
    Object.entries(providerCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  // ── Aggregate table data ───────────────────────────────────
  const aggKey = (r: LlmCall) => `${r.provider ?? "unknown"}|${r.mode ?? "—"}`;
  const aggMap: Record<
    string,
    { calls: number; latencySum: number; successCount: number; costSum: number }
  > = {};

  for (const r of rows) {
    const k = aggKey(r);
    if (!aggMap[k]) {
      aggMap[k] = { calls: 0, latencySum: 0, successCount: 0, costSum: 0 };
    }
    aggMap[k].calls += 1;
    aggMap[k].latencySum += r.latency_ms ?? 0;
    aggMap[k].successCount += r.success ? 1 : 0;
    aggMap[k].costSum += r.cost_usd ?? 0;
  }

  const tableRows: AnalyticsRow[] = Object.entries(aggMap)
    .map(([key, agg]) => {
      const [provider, mode] = key.split("|");
      return {
        provider,
        mode,
        calls: agg.calls,
        avg_latency: agg.calls > 0 ? agg.latencySum / agg.calls : 0,
        success_rate: agg.calls > 0 ? agg.successCount / agg.calls : 0,
        total_cost: agg.costSum,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-muted-foreground">
          Last 7 days — auto-refreshes on page load.
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1 transition-all disabled:opacity-40"
        >
          <Loader2 size={11} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : totalCalls === 0 ? (
        /* Empty state */
        <div className="flex items-start gap-3 px-4 py-5 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs font-mono text-amber-300/80 leading-relaxed">
            No data yet — analytics populate after the first conversation with MAVIS.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <AnalyticsSummaryCard
              label="Total Calls"
              value={totalCalls.toLocaleString()}
            />
            <AnalyticsSummaryCard
              label="Avg Latency"
              value={fmtMs(avgLatency)}
            />
            <AnalyticsSummaryCard
              label="Total Cost"
              value={fmtUsd(totalCost)}
            />
            <AnalyticsSummaryCard
              label="Top Provider"
              value={mostUsedProvider}
              sub={`${providerCount[mostUsedProvider] ?? 0} calls`}
            />
          </div>

          {/* Table */}
          <div className="hud-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-normal">
                      Provider
                    </th>
                    <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-normal">
                      Mode
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-normal">
                      Calls
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-normal">
                      Avg Latency
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-normal">
                      Success
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-widest text-muted-foreground font-normal">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-border/50 last:border-none hover:bg-muted/10 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-foreground capitalize">
                        {row.provider}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.mode !== "—" ? (
                          <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border bg-primary/10 border-primary/30 text-primary">
                            {row.mode}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {row.calls}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {fmtMs(row.avg_latency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span
                          className={
                            row.success_rate >= 0.9
                              ? "text-green-400"
                              : row.success_rate >= 0.7
                              ? "text-amber-400"
                              : "text-red-400"
                          }
                        >
                          {fmtPct(row.success_rate)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {fmtUsd(row.total_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// SystemSettingsPage — root export
// ============================================================

export function SystemSettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="System Settings"
        subtitle="Standing orders, custom skills, and LLM usage analytics"
        icon={<BarChart2 size={16} />}
      />

      <Tabs defaultValue="standing-orders" className="w-full">
        <TabsList className="font-mono text-xs h-9 mb-4">
          <TabsTrigger value="standing-orders" className="gap-1.5 text-xs font-mono">
            <BookOpen size={12} />
            Standing Orders
          </TabsTrigger>
          <TabsTrigger value="custom-skills" className="gap-1.5 text-xs font-mono">
            <Wrench size={12} />
            Custom Skills
          </TabsTrigger>
          <TabsTrigger value="llm-analytics" className="gap-1.5 text-xs font-mono">
            <BarChart2 size={12} />
            LLM Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="standing-orders">
          <StandingOrdersTab />
        </TabsContent>

        <TabsContent value="custom-skills">
          <CustomSkillsTab />
        </TabsContent>

        <TabsContent value="llm-analytics">
          <LlmAnalyticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
