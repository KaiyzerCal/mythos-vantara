// ============================================================
// VANTARA.EXE — GoalsPage
// Goal decomposition and tracking
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target, Plus, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Trash2, Loader2, X, Flag, Link2,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ─── Types ──────────────────────────────────────────────────
type GoalStatus = "active" | "completed" | "abandoned";
type StatusFilter = "all" | GoalStatus;

interface MavisGoal {
  id: string;
  user_id: string;
  objective: string;
  context: string | null;
  status: GoalStatus;
  decomposed: boolean;
  quest_ids: string[] | null;
  created_at: string;
  updated_at: string | null;
}

interface MavisTask {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  payload?: Record<string, unknown> | null;
}

interface CreateForm {
  objective: string;
  context: string;
}

// ─── Helpers ────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_FILTER_LABELS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "abandoned", label: "Abandoned" },
];

const STATUS_BADGE: Record<GoalStatus, string> = {
  active: "bg-green-900/40 text-green-300 border-green-700",
  completed: "bg-blue-900/40 text-blue-300 border-blue-700",
  abandoned: "bg-zinc-800/40 text-zinc-400 border-zinc-600",
};

// ─── GoalsPage ──────────────────────────────────────────────
export function GoalsPage() {
  const { user } = useAuth();
  const { quests, tasks, lastActionTs } = useAppData();

  const [goals, setGoals] = useState<MavisGoal[]>([]);
  const [mavisTasks, setMavisTasks] = useState<MavisTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>({ objective: "", context: "" });
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  // ─── Fetch ─────────────────────────────────────────────────
  const fetchGoals = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: goalsData }, { data: tasksData }] = await Promise.all([
      supabase
        .from("mavis_goals")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("mavis_tasks")
        .select("*")
        .eq("user_id", user.id)
        .eq("type", "goal"),
    ]);
    setGoals((goalsData as MavisGoal[]) || []);
    setMavisTasks((tasksData as MavisTask[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);
  useEffect(() => { if (lastActionTs) fetchGoals(); }, [lastActionTs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Create goal ───────────────────────────────────────────
  async function handleCreate() {
    if (!user) return;
    if (!createForm.objective.trim()) { toast.error("Objective is required"); return; }
    setSubmitting(true);
    const { data: newGoal, error } = await supabase
      .from("mavis_goals")
      .insert({
        user_id: user.id,
        objective: createForm.objective.trim(),
        context: createForm.context.trim() || null,
        status: "active",
        decomposed: false,
        quest_ids: [],
      })
      .select()
      .single();

    if (error || !newGoal) {
      toast.error("Failed to create goal");
      setSubmitting(false);
      return;
    }

    setGoals((prev) => [newGoal as MavisGoal, ...prev]);
    toast.success("Goal created — ask MAVIS to decompose it");

    // Trigger MAVIS decomposition (non-blocking, best effort)
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const session = await supabase.auth.getSession();
      if (session.data.session) {
        fetch(`${SUPABASE_URL}/functions/v1/mavis-actions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.data.session.access_token}`,
            apikey: ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: { type: "goal", params: { objective: createForm.objective, context: createForm.context } },
          }),
        }).catch(() => undefined);
      }
    } catch {
      // Silently ignore — MAVIS decomposition is best-effort
    }

    setCreateForm({ objective: "", context: "" });
    setShowCreate(false);
    setSubmitting(false);
  }

  // ─── Update goal status ────────────────────────────────────
  async function updateGoalStatus(id: string, status: GoalStatus) {
    setActionLoading(id);
    setGoals((prev) => prev.map((g) => g.id === id ? { ...g, status } : g));
    const { error } = await supabase
      .from("mavis_goals")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error("Failed to update goal"); fetchGoals(); }
    else toast.success(`Goal marked as ${status}`);
    setActionLoading(null);
  }

  // ─── Delete goal ───────────────────────────────────────────
  async function handleDelete(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    const { error } = await supabase.from("mavis_goals").delete().eq("id", id);
    if (error) { toast.error("Failed to delete goal"); fetchGoals(); }
    else toast.success("Goal deleted");
    if (expandedGoalId === id) setExpandedGoalId(null);
  }

  // ─── Stats ─────────────────────────────────────────────────
  const activeCount = goals.filter((g) => g.status === "active").length;
  const completedCount = goals.filter((g) => g.status === "completed").length;
  const decomposedCount = goals.filter((g) => g.decomposed).length;

  // ─── Filtered goals ────────────────────────────────────────
  const filteredGoals = statusFilter === "all" ? goals : goals.filter((g) => g.status === statusFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goals"
        subtitle="Objective decomposition and progress tracking"
        icon={<Target size={18} />}
        actions={
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
          >
            <Plus size={12} /> New Goal
          </button>
        }
      />

      {/* ── Stats Row ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-3 gap-3"
      >
        {[
          { label: "Active", value: activeCount, color: "text-green-400" },
          { label: "Completed", value: completedCount, color: "text-blue-400" },
          { label: "Decomposed", value: decomposedCount, color: "text-primary" },
        ].map((stat) => (
          <HudCard key={stat.label}>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
            <p className={`text-2xl font-display font-bold ${stat.color}`}>{stat.value}</p>
          </HudCard>
        ))}
      </motion.div>

      {/* ── Create Form ───────────────────────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <HudCard glowColor="gold">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-mono text-primary uppercase tracking-widest">New Goal</p>
                <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Objective *</label>
                  <textarea
                    value={createForm.objective}
                    onChange={(e) => setCreateForm((f) => ({ ...f, objective: e.target.value }))}
                    rows={3}
                    placeholder="What do you want to achieve?"
                    className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/40 resize-none"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono text-muted-foreground block mb-0.5">Context (optional)</label>
                  <textarea
                    value={createForm.context}
                    onChange={(e) => setCreateForm((f) => ({ ...f, context: e.target.value }))}
                    rows={2}
                    placeholder="Additional context for MAVIS..."
                    className="w-full bg-muted/30 border border-border rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-primary/40 resize-none"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleCreate}
                    disabled={submitting}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? <Loader2 size={11} className="animate-spin" /> : <Flag size={11} />}
                    Create Goal
                  </button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Status Filter Tabs ────────────────────────────────── */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_FILTER_LABELS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`px-3 py-1 text-xs font-mono rounded border transition-colors ${
              statusFilter === key
                ? "bg-primary/10 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Goal Cards ───────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-primary" size={24} />
        </div>
      ) : filteredGoals.length === 0 ? (
        <HudCard>
          <div className="text-center py-10">
            <Target size={32} className="text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-mono text-muted-foreground">No goals found.</p>
            <p className="text-xs font-mono text-muted-foreground mt-1">Create your first goal to get started.</p>
          </div>
        </HudCard>
      ) : (
        <div className="space-y-3">
          {filteredGoals.map((goal, i) => {
            const linkedQuests = (goal.quest_ids || [])
              .map((qid) => quests.find((q) => q.id === qid))
              .filter(Boolean) as typeof quests;

            const linkedTasks = mavisTasks.filter((t) =>
              t.description?.includes(goal.objective.slice(0, 40)) ||
              (t as unknown as { payload?: { objective?: string } }).payload?.objective === goal.objective
            );

            const isExpanded = expandedGoalId === goal.id;

            return (
              <motion.div
                key={goal.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <HudCard>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${STATUS_BADGE[goal.status]}`}>
                          {goal.status}
                        </span>
                        {goal.decomposed && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-purple-900/40 text-purple-300 border-purple-700">
                            Decomposed
                          </span>
                        )}
                        {(goal.quest_ids?.length ?? 0) > 0 && (
                          <span className="flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded border bg-amber-900/40 text-amber-300 border-amber-700">
                            <Link2 size={8} /> {goal.quest_ids!.length} Quest{goal.quest_ids!.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-display font-bold text-foreground leading-snug">{goal.objective}</p>
                      {goal.context && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{goal.context}</p>
                      )}
                      <p className="text-[9px] font-mono text-muted-foreground mt-1">{fmtDate(goal.created_at)}</p>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <button
                        onClick={() => setExpandedGoalId(isExpanded ? null : goal.id)}
                        className="text-muted-foreground hover:text-primary transition-colors"
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* ── Expanded Section ─────────────────────── */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 pt-4 border-t border-border/40 space-y-4">
                          {/* Linked Quests */}
                          <div>
                            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">
                              Linked Quests ({linkedQuests.length})
                            </p>
                            {linkedQuests.length === 0 ? (
                              <p className="text-[10px] font-mono text-muted-foreground italic">No linked quests</p>
                            ) : (
                              <div className="space-y-2">
                                {linkedQuests.map((q) => (
                                  <div key={q.id} className="p-2 rounded bg-muted/20 border border-border/40">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs font-mono text-foreground">{q.title}</span>
                                      <span className="text-[9px] font-mono text-muted-foreground capitalize">{q.status}</span>
                                    </div>
                                    <ProgressBar
                                      value={q.progress_current}
                                      max={q.progress_target || 1}
                                      colorClass="bg-primary/60"
                                      height="xs"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Linked Tasks */}
                          <div>
                            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-2">
                              Linked Tasks ({linkedTasks.length})
                            </p>
                            {linkedTasks.length === 0 ? (
                              <p className="text-[10px] font-mono text-muted-foreground italic">
                                No linked tasks yet — ask MAVIS to decompose this goal
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {linkedTasks.map((t) => (
                                  <div key={t.id} className="flex items-center gap-2 p-2 rounded bg-muted/20 border border-border/40">
                                    <CheckCircle2 size={11} className={t.status === "completed" ? "text-green-400" : "text-muted-foreground"} />
                                    <span className="text-xs font-mono text-foreground flex-1 truncate">{t.title}</span>
                                    <span className="text-[9px] font-mono text-muted-foreground capitalize">{t.status}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 flex-wrap">
                            {goal.status === "active" && (
                              <>
                                <button
                                  onClick={() => updateGoalStatus(goal.id, "completed")}
                                  disabled={actionLoading === goal.id}
                                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono bg-blue-900/30 border border-blue-700/50 text-blue-300 rounded hover:bg-blue-900/50 disabled:opacity-50 transition-colors"
                                >
                                  {actionLoading === goal.id ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                                  Complete Goal
                                </button>
                                <button
                                  onClick={() => updateGoalStatus(goal.id, "abandoned")}
                                  disabled={actionLoading === goal.id}
                                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono bg-zinc-800/50 border border-zinc-600/50 text-zinc-400 rounded hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                                >
                                  <XCircle size={10} /> Abandon
                                </button>
                              </>
                            )}
                            {goal.status !== "active" && (
                              <button
                                onClick={() => updateGoalStatus(goal.id, "active")}
                                disabled={actionLoading === goal.id}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono bg-green-900/30 border border-green-700/50 text-green-300 rounded hover:bg-green-900/50 disabled:opacity-50 transition-colors"
                              >
                                {actionLoading === goal.id ? <Loader2 size={10} className="animate-spin" /> : <Target size={10} />}
                                Reactivate
                              </button>
                            )}
                            <button
                              onClick={() => setConfirmDelete({ id: goal.id, label: goal.objective.slice(0, 60) })}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono bg-red-900/20 border border-red-700/40 text-red-400 rounded hover:bg-red-900/40 transition-colors ml-auto"
                            >
                              <Trash2 size={10} /> Delete
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </HudCard>
              </motion.div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete goal?"
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
