import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/SharedUI";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { Radar, Play, Zap, CheckCircle, Clock, AlertCircle, XCircle, ChevronRight, Target } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

interface Plan {
  id: string;
  title: string;
  goal: string;
  summary: string | null;
  status: string;
  total_steps: number;
  done_steps: number;
  created_at: string;
}

interface PlanStep {
  id: string;
  plan_id: string;
  step_index: number;
  title: string;
  description: string | null;
  type: string | null;
  status: string;
  result: string | null;
  error: string | null;
  completed_at: string | null;
}

interface QueueAction {
  id: string;
  action_type: string;
  status: string;
  priority: number;
  autonomy_tier: string | null;
  created_at: string;
  executed_at: string | null;
  agent_name: string | null;
}

interface Run {
  id: number;
  job_name: string;
  triggered_at: string;
  status: string;
  response_code: number | null;
  notes: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function stepStatusColor(status: string) {
  switch (status) {
    case "completed": return "text-green-400 border-green-500/30 bg-green-500/5";
    case "running":   return "text-blue-400 border-blue-500/30 bg-blue-500/5";
    case "failed":    return "text-red-400 border-red-500/30 bg-red-500/5";
    case "pending":   return "text-amber-400 border-amber-500/30 bg-amber-500/5";
    default:          return "text-muted-foreground border-border bg-muted/10";
  }
}

function stepIcon(status: string) {
  switch (status) {
    case "completed": return <CheckCircle size={12} />;
    case "running":   return <Zap size={12} />;
    case "failed":    return <XCircle size={12} />;
    default:          return <Clock size={12} />;
  }
}

export default function AutonomyPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [queue, setQueue] = useState<QueueAction[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [creating, setCreating] = useState(false);
  const [cycling, setCycling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-autonomy-orchestrator", { method: "GET" });
      if (error) throw error;
      setPlans(data?.plans ?? []);
      setSteps(data?.steps ?? []);
      setQueue(data?.queue ?? []);
      setRuns(data?.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Realtime: reload when plans / steps / queue / runs change ──
  useEffect(() => {
    const channel = supabase
      .channel("autonomy-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "mavis_plans" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "mavis_plan_steps" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "mavis_action_queue" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "mavis_autonomous_runs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);


  async function createPlan() {
    if (!goal.trim() || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-autonomy-orchestrator", {
        method: "POST",
        body: { action: "plan", goal: goal.trim(), context: context.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Plan created with ${data.steps} steps`);
      setGoal("");
      setContext("");
      await load();
    } catch (err) {
      toast.error(`Plan failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setCreating(false);
    }
  }

  async function runCycle() {
    setCycling(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-autonomy-orchestrator", {
        method: "POST",
        body: { action: "run_cycle" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Autonomous cycle triggered — engine running in background");
      setTimeout(load, 3000);
    } catch (err) {
      toast.error(`Cycle failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setCycling(false);
    }
  }

  const stepsByPlan = steps.reduce<Record<string, PlanStep[]>>((acc, s) => {
    (acc[s.plan_id] ??= []).push(s);
    return acc;
  }, {});

  const activePlans = plans.filter(p => p.status === "active" || p.status === "running").length;
  const pendingActions = queue.filter(q => q.status === "pending" || q.status === "queued").length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Autonomy Orchestrator"
        subtitle="Goal → Plan → Steps → Actions — MAVIS's autonomous execution surface"
        icon={<Radar size={18} />}
        actions={
          <div className="flex gap-2">
            <button
              onClick={runCycle}
              disabled={cycling}
              className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              <Play size={12} /> {cycling ? "Firing…" : "Run Cycle"}
            </button>
            <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors">
              Refresh
            </button>
          </div>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "Active Plans", value: activePlans, icon: <Target size={14} className="text-primary" /> },
          { label: "Total Steps", value: steps.length, icon: <ChevronRight size={14} className="text-cyan-400" /> },
          { label: "Pending Actions", value: pendingActions, icon: <Clock size={14} className="text-amber-400" /> },
          { label: "Recent Runs", value: runs.length, icon: <Zap size={14} className="text-green-400" /> },
        ].map((s) => (
          <div key={s.label} className="border border-border rounded-lg px-3 py-2.5 flex items-center gap-3">
            {s.icon}
            <div className="flex flex-col">
              <span className="text-[9px] font-mono uppercase text-muted-foreground">{s.label}</span>
              <span className="text-sm font-mono text-foreground">{s.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Goal composer */}
      <div className="border border-border rounded-lg p-3 space-y-2 bg-muted/5">
        <div className="flex items-center gap-2">
          <Target size={12} className="text-primary" />
          <span className="text-xs font-mono text-foreground font-medium">New Goal</span>
          <span className="text-[9px] font-mono text-muted-foreground ml-auto">MAVIS will decompose into steps</span>
        </div>
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Launch Q4 marketing campaign for VANTARA"
          className="w-full bg-background/50 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
        />
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Optional context — budget, deadlines, constraints…"
          rows={2}
          className="w-full bg-background/50 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-none"
        />
        <div className="flex justify-end">
          <button
            onClick={createPlan}
            disabled={!goal.trim() || creating}
            className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
          >
            <Zap size={12} /> {creating ? "MAVIS planning…" : "Create Plan"}
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading autonomy state…" size="lg" />
      ) : error ? (
        <ErrorState title="Failed to load" message={error} onRetry={load} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Plans column */}
          <div className="lg:col-span-2 flex flex-col gap-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">Plans</p>
            {plans.length === 0 ? (
              <div className="border border-dashed border-border rounded-lg py-8 px-4 text-center space-y-3">
                <Target size={20} className="mx-auto text-primary/60" />
                <p className="text-xs font-mono text-muted-foreground">No plans yet. Start with one of these:</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {[
                    "Launch a lead-gen campaign this week",
                    "Audit my top 3 offers and refine positioning",
                    "Prep a 5-post content sprint from my recent notes",
                    "Cold-outreach 20 aligned prospects",
                  ].map((g) => (
                    <button
                      key={g}
                      onClick={() => setGoal(g)}
                      className="text-[10px] font-mono px-2.5 py-1 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors"
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              plans.map(p => {
                const planSteps = stepsByPlan[p.id] ?? [];
                const pct = p.total_steps > 0 ? Math.round((p.done_steps / p.total_steps) * 100) : 0;
                const isOpen = expandedPlan === p.id;
                return (
                  <motion.div key={p.id} layout className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedPlan(isOpen ? null : p.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
                    >
                      <Target size={13} className="text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono font-medium truncate">{p.title}</p>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">{p.goal}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1 bg-muted/20 rounded overflow-hidden max-w-[200px]">
                            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[9px] font-mono text-muted-foreground">
                            {p.done_steps}/{p.total_steps} · {timeAgo(p.created_at)}
                          </span>
                        </div>
                      </div>
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${stepStatusColor(p.status)}`}>
                        {p.status}
                      </span>
                    </button>
                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                          className="overflow-hidden border-t border-border"
                        >
                          <div className="px-3 py-2 space-y-1.5">
                            {p.summary && <p className="text-[10px] font-mono text-muted-foreground italic">{p.summary}</p>}
                            {planSteps.length === 0 ? (
                              <p className="text-[10px] font-mono text-muted-foreground">No steps recorded.</p>
                            ) : (
                              planSteps
                                .sort((a, b) => a.step_index - b.step_index)
                                .map(s => (
                                  <div key={s.id} className="flex items-start gap-2 px-2 py-1.5 rounded bg-muted/10 border border-border/40">
                                    <span className={`shrink-0 mt-0.5 ${stepStatusColor(s.status).split(" ")[0]}`}>{stepIcon(s.status)}</span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] font-mono text-foreground">{s.step_index + 1}. {s.title}</p>
                                      {s.description && <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{s.description}</p>}
                                      {s.error && <p className="text-[10px] font-mono text-red-400 mt-0.5">Error: {s.error}</p>}
                                      {s.result && <p className="text-[10px] font-mono text-green-400 mt-0.5">Result: {s.result}</p>}
                                    </div>
                                    {s.type && (
                                      <span className="text-[9px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0">
                                        {s.type}
                                      </span>
                                    )}
                                  </div>
                                ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            )}
          </div>

          {/* Sidebar: queue + runs */}
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground mb-2">Action Queue</p>
              <div className="space-y-1.5">
                {queue.length === 0 ? (
                  <p className="text-[10px] font-mono text-muted-foreground text-center py-4">Queue empty.</p>
                ) : (
                  queue.slice(0, 10).map(q => (
                    <div key={q.id} className="border border-border rounded px-2.5 py-1.5 flex items-center gap-2">
                      <AlertCircle size={11} className="text-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-mono truncate">{q.action_type}</p>
                        <p className="text-[9px] font-mono text-muted-foreground">
                          {q.agent_name ?? "queue"} · {timeAgo(q.created_at)}
                        </p>
                      </div>
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${stepStatusColor(q.status)}`}>
                        {q.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground mb-2">Recent Runs</p>
              <div className="space-y-1.5">
                {runs.length === 0 ? (
                  <p className="text-[10px] font-mono text-muted-foreground text-center py-4">No runs recorded.</p>
                ) : (
                  runs.slice(0, 10).map(r => (
                    <div key={r.id} className="border border-border rounded px-2.5 py-1.5 flex items-center gap-2">
                      <Zap size={11} className={r.status === "ok" ? "text-green-400" : "text-muted-foreground"} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-mono truncate">{r.job_name}</p>
                        <p className="text-[9px] font-mono text-muted-foreground">{timeAgo(r.triggered_at)}</p>
                      </div>
                      {r.response_code && (
                        <span className="text-[9px] font-mono text-muted-foreground">{r.response_code}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
