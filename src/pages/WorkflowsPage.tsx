// ============================================================
// VANTARA.EXE — WorkflowsPage
// Visual workflow automation builder for MAVIS
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Workflow,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import { buildWorkflow, type WorkflowBlueprint } from "@/mavis/plugins/n8nPlugin";

// ─── Types ──────────────────────────────────────────────────

interface WorkflowStep {
  id: string;
  type:
    | "send_telegram"
    | "send_email"
    | "mavis_generate"
    | "http_request"
    | "upsert_record"
    | "query_db"
    | "sync_connector";
  name: string;
  config: Record<string, any>;
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  trigger_type: "manual" | "schedule";
  trigger_config: Record<string, any>;
  steps: WorkflowStep[];
  is_active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
}

interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: string;
  steps_log: any[];
  started_at: string;
  completed_at: string | null;
}

// ─── Constants ──────────────────────────────────────────────

const STEP_TYPES = [
  {
    type: "send_telegram",
    label: "Send Telegram",
    icon: "📱",
    fields: [
      { key: "message", label: "Message", placeholder: "Use {{output}} to pass previous step output" },
    ],
  },
  {
    type: "mavis_generate",
    label: "AI Generate",
    icon: "🤖",
    fields: [
      { key: "prompt", label: "Prompt", placeholder: "Use {{output}} for previous result" },
      { key: "system", label: "System (optional)", placeholder: "" },
    ],
  },
  {
    type: "sync_connector",
    label: "Sync Connector",
    icon: "🔄",
    fields: [
      {
        key: "connector",
        label: "Connector",
        options: ["oura", "strava", "github", "gmail", "gdrive", "spotify", "hn", "weather"],
      },
    ],
  },
  {
    type: "http_request",
    label: "HTTP Request",
    icon: "🌐",
    fields: [
      { key: "url", label: "URL", placeholder: "https://..." },
      { key: "method", label: "Method", options: ["GET", "POST", "PUT", "DELETE"] },
    ],
  },
  {
    type: "query_db",
    label: "Query Database",
    icon: "🗄️",
    fields: [
      { key: "table", label: "Table name", placeholder: "health_metrics" },
      { key: "columns", label: "Columns (default *)", placeholder: "*" },
    ],
  },
  {
    type: "upsert_record",
    label: "Write Record",
    icon: "✏️",
    fields: [{ key: "table", label: "Table name", placeholder: "my_table" }],
  },
] as const;

type StepTypeName = WorkflowStep["type"];

function getStepDef(type: StepTypeName) {
  return STEP_TYPES.find((s) => s.type === type) ?? STEP_TYPES[0];
}

function makeStep(): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    type: "send_telegram",
    name: "New Step",
    config: {},
  };
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Status badge helpers ─────────────────────────────────────

function RunStatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 border border-green-700">
        <CheckCircle2 size={11} />
        completed
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 border border-red-700">
        <XCircle size={11} />
        failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-900/40 text-yellow-300 border border-yellow-700">
      <Clock size={11} />
      {status}
    </span>
  );
}

// ─── WorkflowsPage ──────────────────────────────────────────

export function WorkflowsPage() {
  const { user } = useAuth();

  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<Record<string, boolean>>({});

  const [showCreate, setShowCreate] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowRow | null>(null);

  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowRow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTriggerType, setFormTriggerType] = useState<"manual" | "schedule">("manual");
  const [formSteps, setFormSteps] = useState<WorkflowStep[]>([]);

  // AI build state
  const [aiBuildInput, setAiBuildInput] = useState("");
  const [aiBuildLoading, setAiBuildLoading] = useState(false);
  const [lastBlueprint, setLastBlueprint] = useState<WorkflowBlueprint | null>(null);

  // ─── Data loading ──────────────────────────────────────────

  const loadWorkflows = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("workflows")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (!error) setWorkflows(data ?? []);
    setLoading(false);
  }, [user]);

  const loadRuns = useCallback(async (wfId: string) => {
    const { data, error } = await (supabase as any)
      .from("workflow_runs")
      .select("*")
      .eq("workflow_id", wfId)
      .order("started_at", { ascending: false })
      .limit(10);
    if (!error) setRuns(data ?? []);
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  // ─── Form helpers ──────────────────────────────────────────

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormTriggerType("manual");
    setFormSteps([]);
  }

  async function handleAiBuild() {
    if (!aiBuildInput.trim()) return;
    setAiBuildLoading(true);
    try {
      const blueprint = await buildWorkflow(aiBuildInput.trim());
      if (!blueprint) {
        toast.error("n8n MCP server not running. Start with: npx @czlonkowski/n8n-mcp");
        return;
      }
      setLastBlueprint(blueprint);
      setFormName(blueprint.name);
      setFormDescription(blueprint.description);
      setFormSteps([]);
      setEditingWorkflow(null);
      setShowCreate(true);
      toast.success(`Blueprint ready: "${blueprint.name}"`);
    } catch (e: any) {
      toast.error(e.message ?? "AI build failed");
    } finally {
      setAiBuildLoading(false);
    }
  }

  function openCreate() {
    resetForm();
    setLastBlueprint(null);
    setEditingWorkflow(null);
    setShowCreate(true);
  }

  function openEdit(wf: WorkflowRow) {
    setFormName(wf.name);
    setFormDescription(wf.description ?? "");
    setFormTriggerType(wf.trigger_type);
    setFormSteps(wf.steps ?? []);
    setEditingWorkflow(wf);
    setShowCreate(true);
  }

  function addStep() {
    setFormSteps((prev) => [...prev, makeStep()]);
  }

  function removeStep(id: string) {
    setFormSteps((prev) => prev.filter((s) => s.id !== id));
  }

  function updateStepField(id: string, field: keyof WorkflowStep, value: any) {
    setFormSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  }

  function updateStepConfig(id: string, key: string, value: string) {
    setFormSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, config: { ...s.config, [key]: value } } : s))
    );
  }

  // ─── Run workflow ─────────────────────────────────────────

  async function runWorkflow(wf: WorkflowRow) {
    setRunning((prev) => ({ ...prev, [wf.id]: true }));
    const {
      data: { session },
    } = await supabase.auth.getSession();
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-workflow-run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ workflow_id: wf.id }),
        }
      );
      const data = await res.json();
      if (data.success) toast.success(`${wf.name} completed`);
      else toast.error(`${wf.name} failed: ${data.error ?? "unknown"}`);
      if (selectedWorkflow?.id === wf.id) await loadRuns(wf.id);
      await loadWorkflows();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRunning((prev) => ({ ...prev, [wf.id]: false }));
    }
  }

  // ─── Save workflow ────────────────────────────────────────

  async function saveWorkflow() {
    if (!user || !formName.trim()) {
      toast.error("Workflow needs a name");
      return;
    }
    if (formSteps.length === 0) {
      toast.error("Add at least one step before saving");
      return;
    }
    const payload = {
      user_id: user.id,
      name: formName.trim(),
      description: formDescription.trim(),
      trigger_type: formTriggerType,
      trigger_config: {},
      steps: formSteps,
      is_active: true,
    };
    if (editingWorkflow) {
      await (supabase as any).from("workflows").update(payload).eq("id", editingWorkflow.id);
      toast.success("Workflow updated");
    } else {
      await (supabase as any).from("workflows").insert(payload);
      toast.success("Workflow created");
    }
    setShowCreate(false);
    setEditingWorkflow(null);
    resetForm();
    await loadWorkflows();
  }

  // ─── Delete workflow ──────────────────────────────────────

  async function deleteWorkflow(wf: WorkflowRow) {
    if (!confirm(`Delete "${wf.name}"?`)) return;
    await (supabase as any).from("workflows").delete().eq("id", wf.id);
    toast.success("Workflow deleted");
    if (selectedWorkflow?.id === wf.id) setSelectedWorkflow(null);
    await loadWorkflows();
  }

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Workflows"
        subtitle="Automate MAVIS actions"
        icon={<Workflow size={18} />}
        actions={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus size={13} />
            New Workflow
          </button>
        }
      />

      {/* AI Build bar */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={aiBuildInput}
          onChange={e => setAiBuildInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAiBuild()}
          disabled={aiBuildLoading}
          placeholder="Describe a workflow in plain language… (requires n8n MCP server)"
          className="flex-1 bg-muted/20 border border-border rounded px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
        />
        <button
          onClick={handleAiBuild}
          disabled={aiBuildLoading || !aiBuildInput.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded text-xs font-mono bg-violet-500/10 border border-violet-500/30 text-violet-300 hover:bg-violet-500/20 transition-colors disabled:opacity-50 shrink-0"
        >
          {aiBuildLoading ? (
            <><span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" /> Building...</>
          ) : (
            "AI Build"
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left: Workflow list */}
        <div className="md:col-span-2 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 size={20} className="animate-spin mr-2" />
              Loading workflows…
            </div>
          ) : workflows.length === 0 ? (
            <HudCard>
              <p className="text-sm text-muted-foreground text-center py-8">
                No workflows yet. Create your first automation.
              </p>
            </HudCard>
          ) : (
            workflows.map((wf) => (
              <HudCard key={wf.id} glowColor="gold">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-sm text-foreground truncate">
                        {wf.name}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase tracking-wide">
                        {wf.trigger_type}
                      </span>
                      {wf.last_run_status && (
                        <RunStatusBadge status={wf.last_run_status} />
                      )}
                    </div>
                    {wf.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {wf.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {wf.steps?.length ?? 0} step{(wf.steps?.length ?? 0) !== 1 ? "s" : ""}
                      {wf.last_run_at && (
                        <span className="ml-2 opacity-60">
                          Last run: {fmtDate(wf.last_run_at)}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => runWorkflow(wf)}
                      disabled={running[wf.id]}
                      title="Run"
                      className="p-1.5 rounded text-green-400 hover:bg-green-900/30 transition-colors disabled:opacity-50"
                    >
                      {running[wf.id] ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => openEdit(wf)}
                      title="Edit"
                      className="p-1.5 rounded text-blue-400 hover:bg-blue-900/30 transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => deleteWorkflow(wf)}
                      title="Delete"
                      className="p-1.5 rounded text-red-400 hover:bg-red-900/30 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (selectedWorkflow?.id === wf.id) {
                          setSelectedWorkflow(null);
                        } else {
                          setSelectedWorkflow(wf);
                          loadRuns(wf.id);
                        }
                      }}
                      title="Run History"
                      className={`p-1.5 rounded transition-colors text-xs font-mono ${
                        selectedWorkflow?.id === wf.id
                          ? "bg-primary/20 text-primary border border-primary/30"
                          : "text-zinc-400 hover:bg-zinc-800"
                      }`}
                    >
                      <Clock size={14} />
                    </button>
                  </div>
                </div>
              </HudCard>
            ))
          )}
        </div>

        {/* Right: Run history */}
        <div className="md:col-span-1">
          {selectedWorkflow ? (
            <HudCard>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-mono text-xs font-bold text-primary truncate">
                  {selectedWorkflow.name} — Run History
                </h3>
                <button
                  onClick={() => setSelectedWorkflow(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={13} />
                </button>
              </div>

              {runs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No runs yet.</p>
              ) : (
                <div className="space-y-2">
                  {runs.map((run) => (
                    <div key={run.id} className="border border-border rounded p-2">
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() =>
                          setExpandedRun(expandedRun === run.id ? null : run.id)
                        }
                      >
                        <RunStatusBadge status={run.status} />
                        <span className="text-xs text-muted-foreground ml-2 flex-1 text-right">
                          {fmtDate(run.started_at)}
                        </span>
                        {expandedRun === run.id ? (
                          <ChevronUp size={12} className="ml-1 text-muted-foreground" />
                        ) : (
                          <ChevronDown size={12} className="ml-1 text-muted-foreground" />
                        )}
                      </div>

                      <AnimatePresence>
                        {expandedRun === run.id && Array.isArray(run.steps_log) && run.steps_log.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden mt-2 space-y-1"
                          >
                            {run.steps_log.map((sl: any, idx: number) => (
                              <div key={idx} className="text-xs bg-zinc-900/60 rounded p-1.5">
                                <div className="flex items-center gap-1 font-mono">
                                  {sl.status === "ok" ? (
                                    <CheckCircle2 size={10} className="text-green-400 shrink-0" />
                                  ) : (
                                    <XCircle size={10} className="text-red-400 shrink-0" />
                                  )}
                                  <span className="text-foreground/80 truncate">{sl.name ?? sl.type}</span>
                                  {sl.duration_ms != null && (
                                    <span className="ml-auto text-muted-foreground shrink-0">
                                      {sl.duration_ms}ms
                                    </span>
                                  )}
                                </div>
                                {sl.output && (
                                  <p className="text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                                    {sl.output}
                                  </p>
                                )}
                                {sl.error && (
                                  <p className="text-red-400 mt-0.5 line-clamp-2">{sl.error}</p>
                                )}
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              )}
            </HudCard>
          ) : (
            <HudCard>
              <p className="text-xs text-muted-foreground text-center py-6 font-mono">
                Select a workflow to view run history.
              </p>
            </HudCard>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => {
                setShowCreate(false);
                setEditingWorkflow(null);
                resetForm();
              }}
            />

            {/* Modal */}
            <motion.div
              className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto hud-border rounded-xl bg-background p-6 shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-base font-bold text-glow-gold">
                  {editingWorkflow ? `Edit: ${editingWorkflow.name}` : "Create Workflow"}
                </h2>
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setEditingWorkflow(null);
                    resetForm();
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                {/* AI Blueprint info */}
                {lastBlueprint && (
                  <div className="px-3 py-2 rounded bg-violet-500/5 border border-violet-500/20 text-violet-300 text-[10px] font-mono">
                    <span className="font-bold text-violet-400">AI Blueprint loaded</span> — form pre-filled from n8n blueprint. Add steps manually or save the workflow as-is.
                    {lastBlueprint.nodes?.length ? <span className="ml-2 text-muted-foreground">({lastBlueprint.nodes.length} n8n nodes)</span> : null}
                  </div>
                )}

                {/* Name */}
                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1 block">
                    Workflow Name *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Morning Brief Automation"
                    className="w-full bg-zinc-900 border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1 block">
                    Description
                  </label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="What does this workflow do?"
                    rows={2}
                    className="w-full bg-zinc-900 border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 resize-none"
                  />
                </div>

                {/* Trigger type */}
                <div>
                  <label className="text-xs font-mono text-muted-foreground mb-1 block">
                    Trigger
                  </label>
                  <div className="flex gap-2">
                    {(["manual", "schedule"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setFormTriggerType(t)}
                        className={`px-3 py-1.5 rounded text-xs font-mono border transition-colors uppercase ${
                          formTriggerType === t
                            ? "bg-primary/20 border-primary/40 text-primary"
                            : "border-border text-muted-foreground hover:border-zinc-600"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Steps */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-mono text-muted-foreground">Steps</label>
                    <button
                      onClick={addStep}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >
                      <Plus size={11} />
                      Add Step
                    </button>
                  </div>

                  {formSteps.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded">
                      No steps yet. Add your first step above.
                    </p>
                  )}

                  <div className="space-y-3">
                    {formSteps.map((step, idx) => {
                      const stepDef = getStepDef(step.type);
                      return (
                        <div
                          key={step.id}
                          className="border border-border rounded p-3 bg-zinc-900/50 space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground w-5 shrink-0">
                              {idx + 1}.
                            </span>

                            {/* Type selector */}
                            <select
                              value={step.type}
                              onChange={(e) =>
                                updateStepField(step.id, "type", e.target.value as WorkflowStep["type"])
                              }
                              className="bg-zinc-800 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary/50 flex-shrink-0"
                            >
                              {STEP_TYPES.map((st) => (
                                <option key={st.type} value={st.type}>
                                  {st.icon} {st.label}
                                </option>
                              ))}
                            </select>

                            {/* Step name */}
                            <input
                              type="text"
                              value={step.name}
                              onChange={(e) => updateStepField(step.id, "name", e.target.value)}
                              placeholder="Step name"
                              className="flex-1 bg-zinc-800 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary/50 min-w-0"
                            />

                            <button
                              onClick={() => removeStep(step.id)}
                              className="text-red-400 hover:text-red-300 transition-colors shrink-0"
                            >
                              <X size={13} />
                            </button>
                          </div>

                          {/* Dynamic config fields */}
                          {stepDef.fields.map((field) => {
                            const hasOptions = "options" in field && Array.isArray(field.options);
                            return (
                              <div key={field.key} className="flex items-center gap-2 pl-7">
                                <label className="text-xs text-muted-foreground w-28 shrink-0">
                                  {field.label}
                                </label>
                                {hasOptions ? (
                                  <select
                                    value={step.config[field.key] ?? ""}
                                    onChange={(e) => updateStepConfig(step.id, field.key, e.target.value)}
                                    className="flex-1 bg-zinc-800 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary/50"
                                  >
                                    <option value="">Select…</option>
                                    {(field as any).options.map((opt: string) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type="text"
                                    value={step.config[field.key] ?? ""}
                                    onChange={(e) => updateStepConfig(step.id, field.key, e.target.value)}
                                    placeholder={"placeholder" in field ? field.placeholder : ""}
                                    className="flex-1 bg-zinc-800 border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary/50"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <button
                    onClick={() => {
                      setShowCreate(false);
                      setEditingWorkflow(null);
                      resetForm();
                    }}
                    className="px-4 py-1.5 rounded text-xs font-mono border border-border text-muted-foreground hover:text-foreground hover:border-zinc-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveWorkflow}
                    className="px-4 py-1.5 rounded text-xs font-mono bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors"
                  >
                    {editingWorkflow ? "Update" : "Create"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
