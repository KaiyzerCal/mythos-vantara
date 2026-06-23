// ============================================================
// VANTARA.EXE — WorkflowsPage (Visual Node Graph Editor)
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Background,
  Controls,
  Handle,
  Position,
  BackgroundVariant,
  Panel,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
  ArrowLeft,
  Save,
  Mail,
  MessageSquare,
  Bot,
  Globe,
  Database,
  GitBranch,
  RefreshCw,
  Repeat,
  Variable,
  Zap,
  Calendar,
  Link2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────

interface WorkflowStep {
  id: string;
  type: string;
  name: string;
  config: Record<string, any>;
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  trigger_type: "manual" | "schedule" | "webhook";
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

// ─── Step definitions (palette) ──────────────────────────────

type FieldDef =
  | { key: string; label: string; type: "text"; placeholder?: string }
  | { key: string; label: string; type: "textarea"; placeholder?: string }
  | { key: string; label: string; type: "select"; options: string[] };

interface StepDef {
  label: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
  color: string;
  borderColor: string;
  bgColor: string;
  isRoot?: boolean;
  category: "trigger" | "action" | "logic";
  fields: FieldDef[];
}

const STEP_DEFS: Record<string, StepDef> = {
  manual_trigger: {
    label: "Manual Trigger", Icon: Zap, color: "text-amber-400",
    borderColor: "border-amber-700", bgColor: "bg-amber-900/20",
    isRoot: true, category: "trigger", fields: [],
  },
  schedule_trigger: {
    label: "Schedule", Icon: Calendar, color: "text-blue-400",
    borderColor: "border-blue-700", bgColor: "bg-blue-900/20",
    isRoot: true, category: "trigger",
    fields: [
      { key: "cron", label: "Cron Expression", type: "text", placeholder: "0 9 * * 1-5 (9am Mon–Fri)" },
    ],
  },
  webhook_trigger: {
    label: "Webhook", Icon: Link2, color: "text-purple-400",
    borderColor: "border-purple-700", bgColor: "bg-purple-900/20",
    isRoot: true, category: "trigger", fields: [],
  },
  send_email: {
    label: "Send Email", Icon: Mail, color: "text-green-400",
    borderColor: "border-green-700", bgColor: "bg-green-900/20",
    category: "action",
    fields: [
      { key: "to", label: "To", type: "text", placeholder: "user@example.com" },
      { key: "from_name", label: "From Name", type: "text", placeholder: "MAVIS" },
      { key: "subject", label: "Subject", type: "text", placeholder: "Weekly Update" },
      { key: "body", label: "Body (use {{output}} for prev step)", type: "textarea", placeholder: "{{output}}" },
      { key: "generate_prompt", label: "AI Prompt (overrides Body)", type: "textarea", placeholder: "Write an outreach email based on: {{output}}" },
    ],
  },
  send_telegram: {
    label: "Telegram", Icon: MessageSquare, color: "text-sky-400",
    borderColor: "border-sky-700", bgColor: "bg-sky-900/20",
    category: "action",
    fields: [
      { key: "message", label: "Message", type: "textarea", placeholder: "{{output}}" },
    ],
  },
  mavis_generate: {
    label: "AI Generate", Icon: Bot, color: "text-violet-400",
    borderColor: "border-violet-700", bgColor: "bg-violet-900/20",
    category: "action",
    fields: [
      { key: "prompt", label: "Prompt", type: "textarea", placeholder: "Summarize: {{output}}" },
      { key: "system", label: "System Prompt (optional)", type: "textarea", placeholder: "You are MAVIS…" },
    ],
  },
  http_request: {
    label: "HTTP Request", Icon: Globe, color: "text-orange-400",
    borderColor: "border-orange-700", bgColor: "bg-orange-900/20",
    category: "action",
    fields: [
      { key: "url", label: "URL", type: "text", placeholder: "https://api.example.com/data" },
      { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "DELETE"] },
    ],
  },
  query_db: {
    label: "Query DB", Icon: Database, color: "text-cyan-400",
    borderColor: "border-cyan-700", bgColor: "bg-cyan-900/20",
    category: "action",
    fields: [
      { key: "table", label: "Table", type: "text", placeholder: "contacts" },
      { key: "columns", label: "Columns", type: "text", placeholder: "* or name,email" },
      { key: "limit", label: "Limit", type: "text", placeholder: "100" },
    ],
  },
  upsert_record: {
    label: "Write Record", Icon: Database, color: "text-teal-400",
    borderColor: "border-teal-700", bgColor: "bg-teal-900/20",
    category: "action",
    fields: [
      { key: "table", label: "Table", type: "text", placeholder: "my_table" },
    ],
  },
  sync_connector: {
    label: "Sync Connector", Icon: RefreshCw, color: "text-indigo-400",
    borderColor: "border-indigo-700", bgColor: "bg-indigo-900/20",
    category: "action",
    fields: [
      { key: "connector", label: "Connector", type: "select", options: ["oura", "strava", "github", "gmail", "gdrive", "spotify", "hn", "weather"] },
    ],
  },
  condition: {
    label: "Condition", Icon: GitBranch, color: "text-yellow-400",
    borderColor: "border-yellow-700", bgColor: "bg-yellow-900/20",
    category: "logic",
    fields: [
      { key: "left", label: "Left Value", type: "text", placeholder: "{{output}}" },
      { key: "operator", label: "Operator", type: "select", options: ["equals", "not_equals", "contains", "not_contains", "gt", "lt", "truthy"] },
      { key: "right", label: "Right Value", type: "text", placeholder: "expected_value" },
    ],
  },
  for_each: {
    label: "For Each", Icon: Repeat, color: "text-pink-400",
    borderColor: "border-pink-700", bgColor: "bg-pink-900/20",
    category: "logic",
    fields: [
      { key: "items", label: "Items (JSON array or {{output}})", type: "text", placeholder: "{{output}}" },
    ],
  },
  set_variable: {
    label: "Set Variable", Icon: Variable, color: "text-rose-400",
    borderColor: "border-rose-700", bgColor: "bg-rose-900/20",
    category: "logic",
    fields: [
      { key: "var_name", label: "Variable Name", type: "text", placeholder: "myVar" },
      { key: "value", label: "Value", type: "text", placeholder: "{{output}}" },
    ],
  },
};

// ─── Node data type ──────────────────────────────────────────

interface StepNodeData {
  stepType: string;
  name: string;
  config: Record<string, any>;
  isRoot?: boolean;
  [key: string]: unknown;
}

// ─── Custom node (defined at module level to avoid re-renders) ─

function StepNode({ data, selected }: NodeProps) {
  const d = data as StepNodeData;
  const def = STEP_DEFS[d.stepType] ?? STEP_DEFS["send_email"];
  const { Icon, color, borderColor, bgColor } = def;
  return (
    <div
      className={`min-w-[160px] rounded-lg border ${borderColor} ${bgColor} px-3 py-2 text-xs font-mono shadow-lg cursor-pointer select-none transition-all ${
        selected ? "ring-2 ring-white/30 ring-offset-1 ring-offset-zinc-950" : "hover:opacity-90"
      }`}
    >
      {!d.isRoot && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2.5 !h-2.5 !bg-zinc-600 !border-zinc-500"
        />
      )}
      <div className="flex items-center gap-2">
        <Icon size={13} className={`shrink-0 ${color}`} />
        <span className="font-semibold text-white/90 truncate max-w-[120px]">
          {d.name || def.label}
        </span>
      </div>
      <div className="text-zinc-500 mt-0.5 text-xs truncate">{def.label}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2.5 !h-2.5 !bg-zinc-600 !border-zinc-500"
      />
    </div>
  );
}

const nodeTypes = { stepNode: StepNode };

// ─── Config Panel ─────────────────────────────────────────────

interface ConfigPanelProps {
  node: Node | null;
  onUpdate: (id: string, partial: Partial<StepNodeData>) => void;
  onDelete: (id: string) => void;
}

function ConfigPanel({ node, onUpdate, onDelete }: ConfigPanelProps) {
  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
        <p className="text-xs text-zinc-500 font-mono text-center">
          Click a node on the canvas to configure it
        </p>
      </div>
    );
  }

  const d = node.data as StepNodeData;
  const def = STEP_DEFS[d.stepType] ?? { fields: [] as FieldDef[], label: d.stepType };

  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono font-bold text-primary/80">{def.label}</span>
        {!d.isRoot && (
          <button onClick={() => onDelete(node.id)} className="text-red-400 hover:text-red-300 transition-colors">
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div>
        <label className="text-xs font-mono text-zinc-500 block mb-1">Label</label>
        <input
          type="text"
          value={d.name}
          onChange={(e) => onUpdate(node.id, { name: e.target.value })}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-primary/50"
        />
      </div>

      {def.fields.map((field) => (
        <div key={field.key}>
          <label className="text-xs font-mono text-zinc-500 block mb-1">{field.label}</label>
          {field.type === "select" ? (
            <select
              value={d.config[field.key] ?? ""}
              onChange={(e) => onUpdate(node.id, { config: { ...d.config, [field.key]: e.target.value } })}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-primary/50"
            >
              <option value="">Select…</option>
              {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : field.type === "textarea" ? (
            <textarea
              rows={3}
              value={d.config[field.key] ?? ""}
              onChange={(e) => onUpdate(node.id, { config: { ...d.config, [field.key]: e.target.value } })}
              placeholder={"placeholder" in field ? field.placeholder : ""}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-primary/50 resize-none leading-relaxed"
            />
          ) : (
            <input
              type="text"
              value={d.config[field.key] ?? ""}
              onChange={(e) => onUpdate(node.id, { config: { ...d.config, [field.key]: e.target.value } })}
              placeholder={"placeholder" in field ? field.placeholder : ""}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-primary/50"
            />
          )}
        </div>
      ))}

      {d.stepType === "send_email" && (
        <p className="text-xs text-zinc-600 font-mono leading-relaxed">
          Tip: fill either Body or AI Prompt — not both. Use {"{{output}}"} to inject the previous step's result.
        </p>
      )}
      {d.stepType === "for_each" && (
        <p className="text-xs text-zinc-600 font-mono leading-relaxed">
          Tip: Steps after this node run once per item. Use {"{{item}}"} in downstream steps.
        </p>
      )}
    </div>
  );
}

// ─── Conversion helpers ───────────────────────────────────────

function makeNodeId() {
  return `node-${crypto.randomUUID().slice(0, 8)}`;
}

function stepsToGraph(
  steps: WorkflowStep[],
  triggerType: string,
  triggerConfig: Record<string, any>,
): { nodes: Node[]; edges: Edge[] } {
  const rootId = "trigger-root";
  const nodes: Node[] = [
    {
      id: rootId,
      type: "stepNode",
      position: { x: 220, y: 30 },
      data: {
        stepType: (triggerType || "manual") + "_trigger",
        name: "Trigger",
        config: triggerConfig ?? {},
        isRoot: true,
      },
    },
  ];
  const edges: Edge[] = [];
  let prevId = rootId;
  steps.forEach((step, i) => {
    const nid = step.id || makeNodeId();
    nodes.push({
      id: nid,
      type: "stepNode",
      position: { x: 220, y: 140 + i * 110 },
      data: { stepType: step.type, name: step.name, config: step.config ?? {} },
    });
    edges.push({
      id: `e-${prevId}-${nid}`,
      source: prevId,
      target: nid,
      animated: true,
      style: { stroke: "#555" },
    });
    prevId = nid;
  });
  return { nodes, edges };
}

function graphToSteps(
  nodes: Node[],
  edges: Edge[],
): { steps: WorkflowStep[]; triggerType: string; triggerConfig: Record<string, any> } {
  const adj: Record<string, string> = {};
  for (const e of edges) {
    // single outgoing edge per node (linear), last wins if multiple
    adj[e.source] = e.target;
  }

  const rootNode = nodes.find((n) => (n.data as StepNodeData).isRoot);
  if (!rootNode) return { steps: [], triggerType: "manual", triggerConfig: {} };

  const rootData = rootNode.data as StepNodeData;
  const rawTrigger = (rootData.stepType as string) || "manual_trigger";
  const triggerType = rawTrigger.replace("_trigger", "");
  const triggerConfig = (rootData.config as Record<string, any>) ?? {};

  // Walk the chain
  const steps: WorkflowStep[] = [];
  let curId: string | undefined = adj[rootNode.id];
  const visited = new Set<string>();
  while (curId && !visited.has(curId)) {
    visited.add(curId);
    const n = nodes.find((x) => x.id === curId);
    if (n) {
      const nd = n.data as StepNodeData;
      steps.push({
        id: n.id,
        type: nd.stepType,
        name: nd.name || nd.stepType,
        config: (nd.config as Record<string, any>) ?? {},
      });
    }
    curId = adj[curId!];
  }

  return { steps, triggerType, triggerConfig };
}

// ─── Helpers ──────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 border border-green-700">
        <CheckCircle2 size={11} />completed
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 border border-red-700">
        <XCircle size={11} />failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-900/40 text-yellow-300 border border-yellow-700">
      <Clock size={11} />{status}
    </span>
  );
}

// ─── Canvas Editor ────────────────────────────────────────────

interface CanvasEditorProps {
  initialName: string;
  initialDescription: string;
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onSave: (
    name: string,
    description: string,
    steps: WorkflowStep[],
    triggerType: string,
    triggerConfig: Record<string, any>,
  ) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

function CanvasEditor({
  initialName,
  initialDescription,
  initialNodes,
  initialEdges,
  onSave,
  onCancel,
  isSaving,
}: CanvasEditorProps) {
  const [wfName, setWfName] = useState(initialName);
  const [wfDesc, setWfDesc] = useState(initialDescription);

  const defaultNodes: Node[] = initialNodes ?? [
    {
      id: "trigger-root",
      type: "stepNode",
      position: { x: 220, y: 30 },
      data: { stepType: "manual_trigger", name: "Start", config: {}, isRoot: true },
    },
  ];

  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges ?? []);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: "#555" } }, eds)),
    [setEdges],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const addNode = useCallback(
    (stepType: string) => {
      const def = STEP_DEFS[stepType];
      if (!def) return;
      const id = makeNodeId();
      const yMax = nodes.reduce((m, n) => Math.max(m, n.position.y), 0);
      const newNode: Node = {
        id,
        type: "stepNode",
        position: { x: 220, y: yMax + 130 },
        data: { stepType, name: def.label, config: {} },
      };
      setNodes((nds) => [...nds, newNode]);
      // Auto-connect from the last node
      const lastNode =
        [...nodes].reverse().find((n) => !(n.data as StepNodeData).isRoot) ??
        nodes.find((n) => (n.data as StepNodeData).isRoot);
      if (lastNode) {
        setEdges((eds) =>
          addEdge(
            { id: `e-${lastNode.id}-${id}`, source: lastNode.id, target: id, animated: true, style: { stroke: "#555" } },
            eds,
          ),
        );
      }
      setSelectedNode(newNode);
    },
    [nodes, setNodes, setEdges],
  );

  const updateNode = useCallback(
    (id: string, partial: Partial<StepNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)),
      );
      setSelectedNode((prev) =>
        prev?.id === id ? { ...prev, data: { ...prev.data, ...partial } } : prev,
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNode(null);
    },
    [setNodes, setEdges],
  );

  const handleSave = async () => {
    if (!wfName.trim()) {
      toast.error("Workflow needs a name");
      return;
    }
    const { steps, triggerType, triggerConfig } = graphToSteps(nodes, edges);
    await onSave(wfName.trim(), wfDesc.trim(), steps, triggerType, triggerConfig);
  };

  const palette = (["trigger", "action", "logic"] as const).map((cat) => ({
    cat,
    items: Object.entries(STEP_DEFS).filter(([, d]) => d.category === cat),
  }));

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-zinc-950/90 backdrop-blur-sm shrink-0 z-10">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white font-mono transition-colors"
        >
          <ArrowLeft size={13} />
          Workflows
        </button>
        <div className="h-4 w-px bg-zinc-800" />
        <input
          type="text"
          value={wfName}
          onChange={(e) => setWfName(e.target.value)}
          placeholder="Workflow name…"
          className="bg-transparent text-sm font-mono font-semibold text-white focus:outline-none placeholder:text-zinc-600 w-44"
        />
        <input
          type="text"
          value={wfDesc}
          onChange={(e) => setWfDesc(e.target.value)}
          placeholder="Description (optional)…"
          className="bg-transparent text-xs font-mono text-zinc-500 focus:outline-none placeholder:text-zinc-700 flex-1 min-w-0"
        />
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 shrink-0"
        >
          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left palette */}
        <div className="w-44 shrink-0 border-r border-border bg-zinc-950 overflow-y-auto p-2">
          {palette.map(({ cat, items }) => (
            <div key={cat} className="mb-3">
              <p className="text-xs uppercase tracking-widest text-zinc-600 font-mono px-1 mb-1.5">
                {cat}
              </p>
              <div className="space-y-1">
                {items.map(([type, def]) => (
                  <button
                    key={type}
                    onClick={() => addNode(type)}
                    title={`Add ${def.label}`}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded border ${def.borderColor} ${def.bgColor} text-left hover:opacity-80 transition-opacity text-xs font-mono`}
                  >
                    <def.Icon size={11} className={`shrink-0 ${def.color}`} />
                    <span className="truncate text-white/70">{def.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            minZoom={0.3}
            maxZoom={2}
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2a2a2a" />
            <Controls
              style={{ background: "#18181b", border: "1px solid #3f3f46" }}
            />
            <Panel position="bottom-center">
              <p className="text-xs text-zinc-600 font-mono bg-zinc-900/80 px-3 py-1 rounded-full border border-zinc-800">
                Click palette to add nodes · Drag handles to connect · Backspace to delete selected
              </p>
            </Panel>
          </ReactFlow>
        </div>

        {/* Right config panel */}
        <div className="w-56 shrink-0 border-l border-border bg-zinc-950 overflow-y-auto">
          <ConfigPanel
            node={selectedNode}
            onUpdate={updateNode}
            onDelete={deleteNode}
          />
        </div>
      </div>
    </div>
  );
}

// ─── WorkflowsPage ──────────────────────────────────────────

export function WorkflowsPage() {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<"list" | "canvas">("list");
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowRow | null>(null);
  const [canvasNodes, setCanvasNodes] = useState<Node[] | undefined>(undefined);
  const [canvasEdges, setCanvasEdges] = useState<Edge[] | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowRow | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

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
    const { data } = await (supabase as any)
      .from("workflow_runs")
      .select("*")
      .eq("workflow_id", wfId)
      .order("started_at", { ascending: false })
      .limit(10);
    setRuns(data ?? []);
  }, []);

  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

  function openCreate() {
    setEditingWorkflow(null);
    setCanvasNodes(undefined);
    setCanvasEdges(undefined);
    setView("canvas");
  }

  function openEdit(wf: WorkflowRow) {
    setEditingWorkflow(wf);
    const { nodes, edges } = stepsToGraph(wf.steps ?? [], wf.trigger_type, wf.trigger_config ?? {});
    setCanvasNodes(nodes);
    setCanvasEdges(edges);
    setView("canvas");
  }

  async function handleSave(
    name: string,
    description: string,
    steps: WorkflowStep[],
    triggerType: string,
    triggerConfig: Record<string, any>,
  ) {
    if (!user) return;
    setIsSaving(true);
    const payload = {
      user_id: user.id,
      name,
      description,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      steps,
      is_active: true,
    };
    try {
      if (editingWorkflow) {
        await (supabase as any).from("workflows").update(payload).eq("id", editingWorkflow.id);
        toast.success("Workflow updated");
      } else {
        await (supabase as any).from("workflows").insert(payload);
        toast.success("Workflow created");
      }
      setView("list");
      setEditingWorkflow(null);
      await loadWorkflows();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function runWorkflow(wf: WorkflowRow) {
    setRunning((prev) => ({ ...prev, [wf.id]: true }));
    const { data: { session } } = await supabase.auth.getSession();
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
        },
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

  async function deleteWorkflow(wf: WorkflowRow) {
    await (supabase as any).from("workflows").delete().eq("id", wf.id);
    toast.success("Workflow deleted");
    if (selectedWorkflow?.id === wf.id) setSelectedWorkflow(null);
    await loadWorkflows();
  }

  if (view === "canvas") {
    return (
      <CanvasEditor
        initialName={editingWorkflow?.name ?? ""}
        initialDescription={editingWorkflow?.description ?? ""}
        initialNodes={canvasNodes}
        initialEdges={canvasEdges}
        onSave={handleSave}
        onCancel={() => { setView("list"); setEditingWorkflow(null); }}
        isSaving={isSaving}
      />
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Workflows"
        subtitle="Visual automation builder — no n8n required"
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Workflow list */}
        <div className="md:col-span-2 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 size={20} className="animate-spin mr-2" />
              Loading workflows…
            </div>
          ) : workflows.length === 0 ? (
            <HudCard>
              <p className="text-sm text-muted-foreground text-center py-8">
                No workflows yet. Click "New Workflow" to build your first automation.
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
                      {wf.last_run_status && <RunStatusBadge status={wf.last_run_status} />}
                    </div>
                    {wf.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{wf.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {wf.steps?.length ?? 0} step{(wf.steps?.length ?? 0) !== 1 ? "s" : ""}
                      {wf.last_run_at && (
                        <span className="ml-2 opacity-60">Last run: {fmtDate(wf.last_run_at)}</span>
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
                      {running[wf.id] ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    </button>
                    <button
                      onClick={() => openEdit(wf)}
                      title="Edit in canvas"
                      className="p-1.5 rounded text-blue-400 hover:bg-blue-900/30 transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => setConfirmDelete({ id: wf.id, label: wf.name })}
                      title="Delete"
                      className="p-1.5 rounded text-red-400 hover:bg-red-900/30 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (selectedWorkflow?.id === wf.id) setSelectedWorkflow(null);
                        else { setSelectedWorkflow(wf); loadRuns(wf.id); }
                      }}
                      title="Run History"
                      className={`p-1.5 rounded transition-colors ${
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

        {/* Run history panel */}
        <div className="md:col-span-1">
          {selectedWorkflow ? (
            <HudCard>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-mono text-xs font-bold text-primary truncate">
                  {selectedWorkflow.name} — Runs
                </h3>
                <button onClick={() => setSelectedWorkflow(null)} className="text-muted-foreground hover:text-foreground">
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
                        onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                      >
                        <RunStatusBadge status={run.status} />
                        <span className="text-xs text-muted-foreground ml-2 flex-1 text-right">
                          {fmtDate(run.started_at)}
                        </span>
                        {expandedRun === run.id
                          ? <ChevronUp size={12} className="ml-1 text-muted-foreground" />
                          : <ChevronDown size={12} className="ml-1 text-muted-foreground" />}
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
                                  {sl.status === "ok"
                                    ? <CheckCircle2 size={10} className="text-green-400 shrink-0" />
                                    : <XCircle size={10} className="text-red-400 shrink-0" />}
                                  <span className="text-foreground truncate">{sl.name ?? sl.type}</span>
                                  {sl.duration_ms != null && (
                                    <span className="ml-auto text-muted-foreground shrink-0">{sl.duration_ms}ms</span>
                                  )}
                                </div>
                                {sl.output && <p className="text-muted-foreground mt-0.5 line-clamp-2">{sl.output}</p>}
                                {sl.error && <p className="text-red-400 mt-0.5 line-clamp-2">{sl.error}</p>}
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

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          const wf = workflows.find((w) => w.id === confirmDelete.id);
          if (wf) await deleteWorkflow(wf);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
