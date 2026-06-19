// ============================================================
// VANTARA.EXE — PlanBoard
// MAVIS execution plans — DAG of steps, status tracking
// ============================================================
import { useState, useEffect } from "react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Circle, Clock, Loader2, Plus, Sparkles, Target, Zap,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface PlanStep {
  id: string;
  plan_id: string;
  step_number: number;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed" | "failed";
  result_summary: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface Plan {
  id: string;
  user_id: string;
  title: string;
  goal: string;
  status: "active" | "completed" | "failed" | "cancelled";
  total_steps: number;
  completed_steps: number;
  created_at: string;
  steps?: PlanStep[];
}

// ─── Helpers ────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const PLAN_STATUS_STYLE: Record<Plan["status"], string> = {
  active:    "bg-blue-900/40 text-blue-300 border-blue-700",
  completed: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
  failed:    "bg-red-900/40 text-red-300 border-red-700",
  cancelled: "bg-zinc-800/40 text-zinc-400 border-zinc-600",
};

const PLAN_STATUS_DOT: Record<Plan["status"], string> = {
  active:    "bg-blue-400",
  completed: "bg-emerald-400",
  failed:    "bg-red-400",
  cancelled: "bg-zinc-500",
};

const STEP_STATUS_STYLE: Record<PlanStep["status"], string> = {
  pending:     "text-zinc-400",
  in_progress: "text-blue-400",
  completed:   "text-emerald-400",
  failed:      "text-red-400",
};

function StepIcon({ status }: { status: PlanStep["status"] }) {
  if (status === "completed")   return <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />;
  if (status === "in_progress") return <Loader2 size={16} className="text-blue-400 animate-spin shrink-0" />;
  if (status === "failed")      return <Zap size={16} className="text-red-400 shrink-0" />;
  return <Circle size={16} className="text-zinc-500 shrink-0" />;
}

// ─── PlanBoard ──────────────────────────────────────────────
export default function PlanBoard() {
  const { user } = useAuth();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [completingStep, setCompletingStep] = useState<string | null>(null);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  // ── Load plans ─────────────────────────────────────────────
  async function loadPlans() {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("mavis_plans")
        .select("*, steps:mavis_plan_steps(*)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      const sorted = (data ?? []).map((p: any) => ({
        ...p,
        steps: (p.steps ?? []).sort((a: PlanStep, b: PlanStep) => a.step_number - b.step_number),
      }));
      setPlans(sorted);
      if (!selectedPlanId && sorted.length > 0) setSelectedPlanId(sorted[0].id);
    } catch (err: any) {
      toast.error("Failed to load plans: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPlans(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create plan via edge function ──────────────────────────
  async function handleCreatePlan() {
    if (!goalInput.trim()) { toast.error("Enter a goal first"); return; }
    setCreating(true);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-planner`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ goal: goalInput.trim(), context: "", auto_create_quests: false }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }
      const result = await res.json();
      toast.success(`Plan created: "${result.title}" — ${result.total_steps} steps`);
      setGoalInput("");
      setShowNewPlan(false);
      await loadPlans();
      if (result.plan_id) setSelectedPlanId(result.plan_id);
    } catch (err: any) {
      toast.error("Failed to create plan: " + err.message);
    } finally {
      setCreating(false);
    }
  }

  // ── Mark step completed ─────────────────────────────────────
  async function markStepCompleted(step: PlanStep) {
    setCompletingStep(step.id);
    try {
      const { error } = await supabase
        .from("mavis_plan_steps")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", step.id);
      if (error) throw error;

      // Update completed_steps count on the plan
      const plan = plans.find((p) => p.id === step.plan_id);
      if (plan) {
        const newCount = Math.min((plan.completed_steps ?? 0) + 1, plan.total_steps);
        await supabase.from("mavis_plans")
          .update({ completed_steps: newCount, status: newCount >= plan.total_steps ? "completed" : "active" })
          .eq("id", step.plan_id);
      }
      toast.success("Step completed");
      await loadPlans();
    } catch (err: any) {
      toast.error("Failed to update step: " + err.message);
    } finally {
      setCompletingStep(null);
    }
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-5 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Target size={20} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">Plan Board</h1>
            <p className="text-xs text-muted-foreground font-mono">MAVIS execution plans · {plans.length} total</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setShowNewPlan((v) => !v)}
          className="bg-blue-600 hover:bg-blue-500 text-white gap-2"
        >
          <Plus size={14} />
          New Plan
        </Button>
      </div>

      {/* New Plan Form */}
      {showNewPlan && (
        <Card className="border-blue-500/30 bg-blue-950/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-blue-300">
              <Sparkles size={14} />
              Create New Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <Textarea
              placeholder="Describe your goal... (e.g., 'Launch my SaaS product by end of month')"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value.slice(0, 500))}
              rows={3}
              className="text-sm resize-none bg-background/60 border-blue-500/30 focus:border-blue-400"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{goalInput.length}/500</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowNewPlan(false); setGoalInput(""); }}
                  disabled={creating}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreatePlan}
                  disabled={creating || !goalInput.trim()}
                  className="bg-blue-600 hover:bg-blue-500 text-white gap-2 text-xs"
                >
                  {creating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {creating ? "Planning..." : "Generate Plan"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main content: two-panel layout */}
      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <div className="p-4 rounded-full bg-zinc-900/50 border border-zinc-700/50">
            <Target size={32} className="text-zinc-500" />
          </div>
          <p className="text-muted-foreground text-sm">No plans yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Left: Plan List */}
          <div className="w-72 shrink-0 flex flex-col gap-2 overflow-y-auto pr-1">
            {plans.map((plan) => {
              const pct = plan.total_steps > 0
                ? Math.round((plan.completed_steps / plan.total_steps) * 100) : 0;
              const isSelected = plan.id === selectedPlanId;
              return (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`text-left w-full rounded-lg border p-3 transition-all ${
                    isSelected
                      ? "border-blue-500/60 bg-blue-950/30 shadow-md shadow-blue-900/20"
                      : "border-border/50 bg-card/50 hover:border-border hover:bg-card"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className={`text-sm font-semibold leading-snug ${isSelected ? "text-blue-200" : "text-foreground"}`}>
                      {plan.title}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded border shrink-0 ${PLAN_STATUS_STYLE[plan.status]}`}>
                      <span className={`w-1 h-1 rounded-full ${PLAN_STATUS_DOT[plan.status]}`} />
                      {plan.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{plan.goal}</p>
                  <div className="space-y-1">
                    <Progress value={pct} className="h-1" />
                    <span className="text-xs text-muted-foreground font-mono">
                      {plan.completed_steps}/{plan.total_steps} steps · {pct}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: Plan Detail */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {selectedPlan ? (
              <PlanDetail
                plan={selectedPlan}
                onMarkComplete={markStepCompleted}
                completingStep={completingStep}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a plan to view details
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PlanDetail ──────────────────────────────────────────────
function PlanDetail({
  plan,
  onMarkComplete,
  completingStep,
}: {
  plan: Plan;
  onMarkComplete: (step: PlanStep) => void;
  completingStep: string | null;
}) {
  const pct = plan.total_steps > 0
    ? Math.round((plan.completed_steps / plan.total_steps) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Plan header */}
      <Card className={`border-l-4 ${
        plan.status === "active" ? "border-l-blue-500" :
        plan.status === "completed" ? "border-l-emerald-500" :
        plan.status === "failed" ? "border-l-red-500" : "border-l-zinc-500"
      }`}>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base font-bold text-foreground leading-snug">{plan.title}</CardTitle>
            <Badge className={`shrink-0 text-xs border ${PLAN_STATUS_STYLE[plan.status]}`}>
              {plan.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-sm text-muted-foreground">{plan.goal}</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono">{plan.completed_steps}/{plan.total_steps} steps</span>
              <span className="font-mono">{pct}%</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            Created {fmtDate(plan.created_at)}
          </p>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Execution Steps
        </h3>
        {(!plan.steps || plan.steps.length === 0) ? (
          <p className="text-sm text-muted-foreground px-1">No steps defined.</p>
        ) : (
          plan.steps.map((step) => (
            <Card
              key={step.id}
              className={`border transition-colors ${
                step.status === "in_progress"
                  ? "border-blue-500/40 bg-blue-950/10"
                  : step.status === "completed"
                  ? "border-emerald-500/20 bg-emerald-950/5"
                  : step.status === "failed"
                  ? "border-red-500/30 bg-red-950/10"
                  : "border-border/50"
              }`}
            >
              <CardContent className="px-4 py-3">
                <div className="flex items-start gap-3">
                  {/* Step icon */}
                  <div className="mt-0.5">
                    <StepIcon status={step.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-muted-foreground shrink-0">
                        #{step.step_number}
                      </span>
                      <span className={`text-sm font-semibold ${STEP_STATUS_STYLE[step.status]}`}>
                        {step.title}
                      </span>
                    </div>
                    {step.description && (
                      <p className="text-xs text-muted-foreground mb-2">{step.description}</p>
                    )}
                    {step.result_summary && (
                      <div className="text-xs bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 mb-2 text-zinc-300">
                        {step.result_summary}
                      </div>
                    )}
                    {/* Timeline */}
                    {(step.started_at || step.completed_at) && (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                        {step.started_at && (
                          <span className="flex items-center gap-1">
                            <Clock size={9} /> Started {fmtDate(step.started_at)}
                          </span>
                        )}
                        {step.completed_at && (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 size={9} className="text-emerald-400" />
                            Done {fmtDate(step.completed_at)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Mark complete button */}
                  {step.status === "pending" || step.status === "in_progress" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onMarkComplete(step)}
                      disabled={completingStep === step.id}
                      className="shrink-0 text-xs h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20"
                    >
                      {completingStep === step.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={12} />
                      )}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
