// ============================================================
// VANTARA.EXE — FactoryPage
// Factorio-style factory floor: MAVIS AI ecosystem visualized
// as a production facility using React Flow v12.
// ============================================================

import { useState, useEffect, useCallback, memo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { RefreshCw, Loader2, X, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";

// ─── Types ───────────────────────────────────────────────────

type LedStatus = "green" | "yellow" | "grey";

interface FactoryNodeData {
  label: string;
  sublabel?: string;
  badge?: string;
  nodeType: "hub" | "persona" | "council" | "integration" | "action";
  status: LedStatus;
  updatedAt?: string;
  [key: string]: unknown;
}

interface InspectedNode {
  id: string;
  label: string;
  nodeType: string;
  sublabel?: string;
  updatedAt?: string;
  status: LedStatus;
}

// ─── Helpers ────────────────────────────────────────────────

function getLedStatus(updatedAt?: string | null): LedStatus {
  if (!updatedAt) return "grey";
  const diff = Date.now() - new Date(updatedAt).getTime();
  const hours = diff / (1000 * 60 * 60);
  if (hours <= 24) return "green";
  if (hours <= 168) return "yellow"; // 7 days
  return "grey";
}

function fmtRelative(iso?: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const LED_COLORS: Record<LedStatus, string> = {
  green: "bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)]",
  yellow: "bg-yellow-400 shadow-[0_0_6px_2px_rgba(250,204,21,0.6)]",
  grey: "bg-zinc-600",
};

const BORDER_COLORS: Record<string, string> = {
  hub: "border-violet-500 shadow-[0_0_12px_2px_rgba(139,92,246,0.3)]",
  persona: "border-cyan-500 shadow-[0_0_8px_1px_rgba(6,182,212,0.2)]",
  council: "border-amber-500 shadow-[0_0_8px_1px_rgba(245,158,11,0.2)]",
  integration: "border-green-600 shadow-[0_0_8px_1px_rgba(22,163,74,0.2)]",
  "integration-grey": "border-zinc-700",
  action: "border-orange-500 shadow-[0_0_8px_1px_rgba(249,115,22,0.2)]",
};

const LABEL_COLORS: Record<string, string> = {
  hub: "text-violet-300",
  persona: "text-cyan-300",
  council: "text-amber-300",
  integration: "text-green-300",
  "integration-grey": "text-zinc-500",
  action: "text-orange-300",
};

// ─── FactoryNode Component ───────────────────────────────────

const FactoryNode = memo(function FactoryNode({ data, selected }: NodeProps) {
  const d = data as FactoryNodeData;
  const borderKey =
    d.nodeType === "integration" && d.status === "grey"
      ? "integration-grey"
      : d.nodeType;

  const borderClass = BORDER_COLORS[borderKey] ?? "border-zinc-700";
  const labelClass = LABEL_COLORS[borderKey] ?? "text-zinc-400";

  return (
    <div
      className={`
        relative min-w-[160px] max-w-[200px]
        bg-[#0f0f0a] border rounded-sm px-3 py-2
        font-mono text-[11px]
        transition-all duration-150
        ${borderClass}
        ${selected ? "ring-1 ring-white/20" : ""}
      `}
    >
      {/* Top handle (target) */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "#555", border: "none", width: 8, height: 8 }}
      />

      {/* Top row: LED + label + badge */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className={`shrink-0 w-2 h-2 rounded-full ${LED_COLORS[d.status]}`}
        />
        <span className={`font-bold truncate leading-tight ${labelClass}`}>
          {d.label}
        </span>
        {d.badge && (
          <span className="ml-auto shrink-0 text-[8px] font-mono uppercase tracking-widest px-1 py-0.5 rounded border border-violet-500/40 bg-violet-900/30 text-violet-300">
            {d.badge}
          </span>
        )}
      </div>

      {/* Sublabel */}
      {d.sublabel && (
        <div className="text-[10px] text-zinc-500 truncate pl-3.5 leading-tight">
          {d.sublabel}
        </div>
      )}

      {/* Status line */}
      <div className="mt-1 pl-3.5 text-[9px] text-zinc-600 uppercase tracking-widest">
        {d.status === "green"
          ? "ACTIVE"
          : d.status === "yellow"
          ? "IDLE"
          : "OFFLINE"}
      </div>

      {/* Bottom handle (source) */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "#555", border: "none", width: 8, height: 8 }}
      />
    </div>
  );
});

// Must be defined OUTSIDE the main component to avoid re-registration on each render
const NODE_TYPES = { factory: FactoryNode };

// ─── Fixed integration definitions ──────────────────────────

const INTEGRATION_DEFS = [
  { id: "int-google", label: "Google Workspace", provider: "google" },
  { id: "int-telegram", label: "Telegram", provider: "telegram" },
  { id: "int-ruview", label: "RuView Sensor", provider: "ruview" },
  { id: "int-mediapipe", label: "MediaPipe", provider: "mediapipe" },
  { id: "int-elevenlabs", label: "ElevenLabs", provider: "elevenlabs" },
];

// Integration → action category mapping (target node IDs)
const INT_TO_ACTION: Record<string, string> = {
  "int-google": "act-productivity",
  "int-telegram": "act-communication",
  "int-ruview": "act-vision",
  "int-mediapipe": "act-vision",
  "int-elevenlabs": "act-communication",
};

const ACTION_DEFS = [
  { id: "act-memory", label: "Memory" },
  { id: "act-vision", label: "Vision" },
  { id: "act-communication", label: "Communication" },
  { id: "act-productivity", label: "Productivity" },
  { id: "act-content", label: "Content" },
  { id: "act-health", label: "Health" },
];

// ─── Edge builder helpers ────────────────────────────────────

function makeEdge(
  id: string,
  source: string,
  target: string,
  color: string,
  opts: Partial<Edge> = {}
): Edge {
  return {
    id,
    source,
    target,
    animated: true,
    style: { stroke: color, strokeWidth: 1.5, strokeDasharray: "6 3" },
    type: "default",
    ...opts,
  };
}

function makeSolidEdge(
  id: string,
  source: string,
  target: string,
  color: string
): Edge {
  return {
    id,
    source,
    target,
    animated: false,
    style: { stroke: color, strokeWidth: 2 },
    type: "default",
  };
}

// ─── Graph builder ───────────────────────────────────────────

interface BuildInput {
  personas: Array<{ id: string; name: string; role: string; archetype?: string; updated_at?: string }>;
  councils: Array<{ id: string; name: string; role: string; specialty?: string; updated_at?: string }>;
  connectedProviders: Set<string>;
}

function buildGraph(input: BuildInput): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // ── MAVIS HUB ──
  nodes.push({
    id: "mavis-hub",
    type: "factory",
    position: { x: 550, y: 350 },
    data: {
      label: "MAVIS PRIME",
      badge: "PRIME",
      nodeType: "hub",
      status: "green",
    } satisfies FactoryNodeData,
  });

  // ── PERSONA nodes ──
  input.personas.forEach((p, i) => {
    const status = getLedStatus(p.updated_at);
    nodes.push({
      id: `persona-${p.id}`,
      type: "factory",
      position: { x: 80, y: 80 + i * 160 },
      data: {
        label: p.name,
        sublabel: p.role,
        nodeType: "persona",
        status,
        updatedAt: p.updated_at,
      } satisfies FactoryNodeData,
    });
    edges.push(
      makeEdge(
        `e-persona-${p.id}`,
        `persona-${p.id}`,
        "mavis-hub",
        "#06b6d4"
      )
    );
  });

  // ── COUNCIL nodes ──
  input.councils.forEach((c, i) => {
    const status = getLedStatus(c.updated_at);
    nodes.push({
      id: `council-${c.id}`,
      type: "factory",
      position: { x: 1020, y: 80 + i * 160 },
      data: {
        label: c.name,
        sublabel: c.specialty ?? c.role,
        nodeType: "council",
        status,
        updatedAt: c.updated_at,
      } satisfies FactoryNodeData,
    });
    edges.push(
      makeEdge(
        `e-council-${c.id}`,
        `council-${c.id}`,
        "mavis-hub",
        "#f59e0b"
      )
    );
  });

  // ── INTEGRATION nodes ──
  INTEGRATION_DEFS.forEach((intDef, i) => {
    const connected = input.connectedProviders.has(intDef.provider);
    const status: LedStatus = connected ? "green" : "grey";
    nodes.push({
      id: intDef.id,
      type: "factory",
      position: { x: 100 + i * 200, y: -80 },
      data: {
        label: intDef.label,
        nodeType: "integration",
        status,
      } satisfies FactoryNodeData,
    });

    // Integration → action category edge
    const targetAction = INT_TO_ACTION[intDef.id];
    if (targetAction) {
      edges.push(
        makeEdge(
          `e-${intDef.id}-${targetAction}`,
          intDef.id,
          targetAction,
          connected ? "#22c55e" : "#3f3f46",
          { animated: connected }
        )
      );
    }
  });

  // ── ACTION CATEGORY nodes ──
  ACTION_DEFS.forEach((actDef, i) => {
    nodes.push({
      id: actDef.id,
      type: "factory",
      position: { x: 100 + i * 190, y: 750 },
      data: {
        label: actDef.label,
        nodeType: "action",
        status: "green",
      } satisfies FactoryNodeData,
    });
    edges.push(
      makeSolidEdge(`e-${actDef.id}-hub`, actDef.id, "mavis-hub", "#f97316")
    );
  });

  return { nodes, edges };
}

// ─── FactoryPage ─────────────────────────────────────────────

export default function FactoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [inspected, setInspected] = useState<InspectedNode | null>(null);

  // Stat counters
  const totalCount = nodes.length;
  const activeCount = nodes.filter(
    (n) => (n.data as FactoryNodeData).status === "green"
  ).length;
  const idleCount = nodes.filter(
    (n) => (n.data as FactoryNodeData).status === "grey"
  ).length;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [personasRes, councilsRes, integrationsRes] = await Promise.all([
        (supabase as any)
          .from("personas")
          .select("id,name,role,archetype,updated_at")
          .eq("user_id", user.id)
          .limit(12),
        (supabase as any)
          .from("councils")
          .select("id,name,role,specialty,updated_at")
          .eq("user_id", user.id)
          .limit(12),
        (supabase as any)
          .from("mavis_user_integrations")
          .select("provider")
          .eq("user_id", user.id),
      ]);

      const personas = personasRes.data ?? [];
      const councils = councilsRes.data ?? [];
      const connectedProviders = new Set<string>(
        (integrationsRes.data ?? []).map((r: { provider: string }) => r.provider)
      );

      const { nodes: builtNodes, edges: builtEdges } = buildGraph({
        personas,
        councils,
        connectedProviders,
      });

      setNodes(builtNodes);
      setEdges(builtEdges);
    } catch (err) {
      console.error("[FactoryPage] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, setNodes, setEdges]);

  useEffect(() => {
    load();
  }, [load]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const d = node.data as FactoryNodeData;
      setInspected({
        id: node.id,
        label: d.label,
        nodeType: d.nodeType,
        sublabel: d.sublabel,
        updatedAt: d.updatedAt,
        status: d.status,
      });
    },
    []
  );

  // ── Render ──
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center gap-4 px-4 py-2.5 border-b border-zinc-800 bg-[#0a0a06]">
        {/* Title */}
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-sm font-bold text-amber-400 tracking-widest uppercase">
            Factory Floor
          </span>
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            MAVIS Production Network
          </span>
        </div>

        <div className="w-px h-8 bg-zinc-800 mx-1" />

        {/* Stat chips */}
        <div className="flex items-center gap-2">
          <StatChip label="NODES" value={totalCount} color="text-zinc-300" />
          <StatChip
            label="ACTIVE"
            value={activeCount}
            color="text-green-400"
            led="green"
          />
          <StatChip
            label="IDLE"
            value={idleCount}
            color="text-zinc-500"
            led="grey"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {loading && (
            <Loader2 size={12} className="animate-spin text-zinc-500" />
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 font-mono text-xs transition-colors disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Flow canvas ── */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          nodeTypes={NODE_TYPES}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          style={{ background: "#0d0d08" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            style={{
              backgroundImage:
                "radial-gradient(circle, #ffffff08 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
            gap={32}
            color="transparent"
          />
          <Controls
            style={{
              background: "#111109",
              border: "1px solid #27272a",
              borderRadius: 4,
            }}
          />
          <MiniMap
            style={{
              background: "#111109",
              border: "1px solid #27272a",
              borderRadius: 4,
            }}
            nodeColor={(n) => {
              const d = n.data as FactoryNodeData;
              if (d.nodeType === "hub") return "#8b5cf6";
              if (d.nodeType === "persona") return "#06b6d4";
              if (d.nodeType === "council") return "#f59e0b";
              if (d.nodeType === "action") return "#f97316";
              return d.status === "green" ? "#22c55e" : "#3f3f46";
            }}
            maskColor="#0d0d0888"
          />
        </ReactFlow>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d08]/70 z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-amber-400" />
              <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                Initializing production network…
              </span>
            </div>
          </div>
        )}

        {/* ── Inspect Panel ── */}
        {inspected && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-4 left-4 z-50 w-64 bg-[#0f0f0a] border border-zinc-700 rounded-sm shadow-2xl font-mono text-xs"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${LED_COLORS[inspected.status]}`}
                />
                <span className="font-bold text-zinc-200 truncate">
                  {inspected.label}
                </span>
              </div>
              <button
                onClick={() => setInspected(null)}
                className="text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <X size={12} />
              </button>
            </div>

            {/* Body */}
            <div className="px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600 uppercase tracking-widest text-[9px]">
                  Type
                </span>
                <span className="text-zinc-400 capitalize">
                  {inspected.nodeType}
                </span>
              </div>
              {inspected.sublabel && (
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 uppercase tracking-widest text-[9px]">
                    Role
                  </span>
                  <span className="text-zinc-400 truncate max-w-[140px] text-right">
                    {inspected.sublabel}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-zinc-600 uppercase tracking-widest text-[9px]">
                  Status
                </span>
                <span
                  className={
                    inspected.status === "green"
                      ? "text-green-400"
                      : inspected.status === "yellow"
                      ? "text-yellow-400"
                      : "text-zinc-500"
                  }
                >
                  {inspected.status === "green"
                    ? "ACTIVE"
                    : inspected.status === "yellow"
                    ? "IDLE"
                    : "OFFLINE"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-600 uppercase tracking-widest text-[9px]">
                  Last activity
                </span>
                <span className="text-zinc-400">
                  {fmtRelative(inspected.updatedAt)}
                </span>
              </div>
            </div>

            {/* Footer: Chat link */}
            <div className="px-3 py-2 border-t border-zinc-800">
              <button
                onClick={() => navigate("/mavis")}
                className="flex items-center gap-1.5 w-full justify-center px-2 py-1.5 rounded border border-violet-700/40 bg-violet-900/20 text-violet-300 hover:bg-violet-900/40 transition-colors text-[10px] uppercase tracking-widest"
              >
                <ExternalLink size={10} />
                Chat with MAVIS
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── StatChip helper ─────────────────────────────────────────

function StatChip({
  label,
  value,
  color,
  led,
}: {
  label: string;
  value: number;
  color: string;
  led?: LedStatus;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-800 bg-zinc-900/60">
      {led && (
        <span className={`w-1.5 h-1.5 rounded-full ${LED_COLORS[led]}`} />
      )}
      <span className={`font-mono text-xs font-bold tabular-nums ${color}`}>
        {value}
      </span>
      <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}
