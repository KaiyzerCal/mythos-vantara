/**
 * MAVIS Command Mesh — Distributed task routing protocol.
 *
 * Adapts OpenJarvis's OrchestratorAgent + ToolExecutor + EventBus patterns
 * for a distributed setup where tasks can route to:
 *   - Local Ollama / OpenClaw (on-device)
 *   - Remote OpenJarvis node (LAN/Tailscale)
 *   - MAVIS cloud (Supabase edge functions)
 *
 * Architecture:
 *   CommandMesh.dispatch(task)
 *     → MeshRouter selects best node (capability + latency + availability)
 *     → EventBus emits TASK_START
 *     → Node executes task
 *     → EventBus emits TASK_END with result
 *
 * This file is the architecture contract. Cloud nodes are wired now;
 * local nodes activate automatically when hardware comes online.
 */

// ── Event bus ─────────────────────────────────────────────────
type EventType =
  | "TASK_START"
  | "TASK_END"
  | "NODE_ONLINE"
  | "NODE_OFFLINE"
  | "MESH_SYNC"
  | "SKILL_EXECUTE_START"
  | "SKILL_EXECUTE_END";

type EventCallback<T = unknown> = (data: T) => void;

class MeshEventBus {
  private _listeners: Map<EventType, EventCallback[]> = new Map();

  publish<T = unknown>(event: EventType, data: T): void {
    for (const cb of this._listeners.get(event) ?? []) {
      try { cb(data); } catch {}
    }
  }

  subscribe<T = unknown>(event: EventType, cb: EventCallback<T>): () => void {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event)!.push(cb as EventCallback);
    return () => {
      const arr = this._listeners.get(event)!;
      this._listeners.set(event, arr.filter((x) => x !== cb));
    };
  }
}

export const meshBus = new MeshEventBus();

// ── Types (mirroring OpenJarvis dataclasses) ──────────────────
export type TaskPriority = "critical" | "high" | "normal" | "background";
export type TaskType =
  | "inference"      // Text generation
  | "embedding"      // Vector embedding
  | "skill"          // Multi-step skill pipeline
  | "tool"           // Single tool execution
  | "transcription"  // Voice → text
  | "analysis";      // Document / image analysis

export type NodeStatus = "online" | "offline" | "degraded" | "unknown";
export type NodeType = "local" | "lan" | "cloud";

export interface MeshNode {
  id: string;
  type: NodeType;
  label: string;           // "OpenClaw · Ollama", "MAVIS Cloud", etc.
  endpoint: string;
  capabilities: TaskType[];
  status: NodeStatus;
  latencyMs?: number;
  lastHealthCheck?: number;
}

export interface MeshTask {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  preferredNode?: string;  // node id
}

export interface MeshResult {
  taskId: string;
  success: boolean;
  content: string;
  nodeId: string;
  nodeType: NodeType;
  durationMs: number;
  error?: string;
}

// ── Skill pipeline (from OpenJarvis SkillStep) ────────────────
export interface SkillStep {
  toolName?: string;
  skillName?: string;
  argumentsTemplate: string; // {key} placeholders resolved from context
  outputKey?: string;        // Store result in context under this key
}

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  steps: SkillStep[];
  requiredCapabilities: TaskType[];
  tags: string[];
}

export interface SkillResult {
  skillName: string;
  success: boolean;
  context: Record<string, unknown>;
  stepResults: string[];
}

/** Renders Jinja2-style {key} templates from a context dict. */
function renderTemplate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(ctx[k] ?? ""));
}

export async function executeSkillPipeline(
  manifest: SkillManifest,
  initialContext: Record<string, unknown>,
  toolFn: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<SkillResult> {
  const ctx = { ...initialContext };
  const stepResults: string[] = [];

  for (const step of manifest.steps) {
    try {
      const rendered = renderTemplate(step.argumentsTemplate, ctx);
      const args = JSON.parse(rendered || "{}");
      const tool = step.toolName ?? step.skillName ?? "noop";

      meshBus.publish("SKILL_EXECUTE_START", { skill: manifest.name, step: tool });
      const result = await toolFn(tool, args);
      meshBus.publish("SKILL_EXECUTE_END", { skill: manifest.name, step: tool, result });

      stepResults.push(result);
      if (step.outputKey) ctx[step.outputKey] = result;
    } catch (err) {
      return {
        skillName: manifest.name,
        success: false,
        context: ctx,
        stepResults,
      };
    }
  }

  return { skillName: manifest.name, success: true, context: ctx, stepResults };
}

// ── Node registry ─────────────────────────────────────────────
class NodeRegistry {
  private _nodes: Map<string, MeshNode> = new Map();

  register(node: MeshNode): void {
    this._nodes.set(node.id, node);
    meshBus.publish("NODE_ONLINE", { node });
  }

  unregister(id: string): void {
    this._nodes.delete(id);
    meshBus.publish("NODE_OFFLINE", { id });
  }

  getAll(): MeshNode[] {
    return Array.from(this._nodes.values());
  }

  getBestFor(type: TaskType, priority: TaskPriority): MeshNode | null {
    const capable = this.getAll().filter(
      (n) => n.status === "online" && n.capabilities.includes(type),
    );
    if (!capable.length) return null;

    // Priority: local > lan > cloud (prefer on-device autonomy)
    // For critical tasks: cloud preferred (reliability)
    if (priority === "critical") {
      return capable.find((n) => n.type === "cloud") ?? capable[0];
    }
    return (
      capable.find((n) => n.type === "local") ??
      capable.find((n) => n.type === "lan") ??
      capable.find((n) => n.type === "cloud") ??
      null
    );
  }
}

export const nodeRegistry = new NodeRegistry();

// ── Pre-register cloud node (always available) ────────────────
nodeRegistry.register({
  id: "mavis-cloud",
  type: "cloud",
  label: "MAVIS Cloud · Supabase",
  endpoint: "/functions/v1/mavis-chat",
  capabilities: ["inference", "embedding", "skill", "tool", "transcription", "analysis"],
  status: "online",
});

// ── CommandMesh dispatcher ────────────────────────────────────
export class CommandMesh {
  async dispatch(
    task: MeshTask,
    executor: (node: MeshNode, task: MeshTask) => Promise<MeshResult>,
  ): Promise<MeshResult> {
    const t0 = Date.now();
    const node =
      (task.preferredNode ? nodeRegistry.getAll().find((n) => n.id === task.preferredNode) : null) ??
      nodeRegistry.getBestFor(task.type, task.priority);

    if (!node) {
      return {
        taskId: task.id,
        success: false,
        content: "",
        nodeId: "none",
        nodeType: "cloud",
        durationMs: Date.now() - t0,
        error: "No capable node available for task type: " + task.type,
      };
    }

    meshBus.publish("TASK_START", { task, nodeId: node.id });

    try {
      const result = await executor(node, task);
      meshBus.publish("TASK_END", { task, result });
      return result;
    } catch (err) {
      const failed: MeshResult = {
        taskId: task.id,
        success: false,
        content: "",
        nodeId: node.id,
        nodeType: node.type,
        durationMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
      meshBus.publish("TASK_END", { task, result: failed });
      return failed;
    }
  }
}

export const commandMesh = new CommandMesh();

// ── Mesh status summary ───────────────────────────────────────
export interface MeshStatusSummary {
  totalNodes: number;
  onlineNodes: number;
  localActive: boolean;
  lanActive: boolean;
  cloudActive: boolean;
}

export function getMeshStatus(): MeshStatusSummary {
  const nodes = nodeRegistry.getAll();
  const online = nodes.filter((n) => n.status === "online");
  return {
    totalNodes: nodes.length,
    onlineNodes: online.length,
    localActive: online.some((n) => n.type === "local"),
    lanActive: online.some((n) => n.type === "lan"),
    cloudActive: online.some((n) => n.type === "cloud"),
  };
}
