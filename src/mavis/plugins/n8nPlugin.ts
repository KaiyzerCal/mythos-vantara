/**
 * n8n Plugin — Autonomous workflow construction and execution for MAVIS.
 *
 * Architecture (priority order):
 *   1. n8n MCP server (port 5678) — full 1,200+ node catalog, construct workflows as JSON
 *   2. n8n REST API — trigger executions, read workflow state
 *   3. Stub mode — logs intent when n8n isn't running
 *
 * What this unlocks vs basic webhook triggers:
 *   - Agent builds complete workflow JSON from natural language
 *   - MAVIS becomes an autonomous integration engineer
 *   - Pairs with mavis-workflow-run edge function already in the repo
 *
 * Install (optional, activates path 1):
 *   npx @czlonkowski/n8n-mcp
 *
 * Env vars (Supabase secrets or localStorage):
 *   N8N_HOST (e.g. "http://localhost:5678" or "https://n8n.yourdomain.com")
 *   N8N_API_KEY
 */

import { pluginRegistry, type MavisPlugin } from "@/mavis/pluginSystem";
import {
  MCP_SERVERS,
  isMcpServerAlive,
  callMcpTool,
  mcpResultText,
} from "@/mavis/mcpBridge";

// ── Config ────────────────────────────────────────────────────────────────────

const N8N_CONFIG_KEY = "mavis-n8n-config";

interface N8nConfig {
  host: string;
  apiKey: string;
}

export function getN8nConfig(): N8nConfig {
  try {
    const raw = localStorage.getItem(N8N_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { host: "http://localhost:5678", apiKey: "" };
}

export function setN8nConfig(cfg: Partial<N8nConfig>) {
  const current = getN8nConfig();
  localStorage.setItem(N8N_CONFIG_KEY, JSON.stringify({ ...current, ...cfg }));
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface WorkflowBlueprint {
  name: string;
  description: string;
  nodes: unknown[];
  connections: unknown;
  settings?: unknown;
}

export interface WorkflowExecution {
  id: string;
  status: "success" | "error" | "running";
  data?: unknown;
}

/** Build a complete n8n workflow from a natural language description */
export async function buildWorkflow(description: string): Promise<WorkflowBlueprint | null> {
  if (await isMcpServerAlive(MCP_SERVERS.n8n)) {
    try {
      const result = await callMcpTool(MCP_SERVERS.n8n, {
        name: "n8n_create_workflow",
        arguments: { description, returnJson: true },
      });
      const text = mcpResultText(result);
      return JSON.parse(text) as WorkflowBlueprint;
    } catch (err) {
      console.warn("[n8nPlugin] MCP build failed:", err);
    }
  }
  return null;
}

/** List nodes available in the n8n catalog */
export async function listN8nNodes(filter?: string): Promise<string[]> {
  if (!await isMcpServerAlive(MCP_SERVERS.n8n)) return [];
  try {
    const result = await callMcpTool(MCP_SERVERS.n8n, {
      name: "n8n_list_nodes",
      arguments: filter ? { filter } : {},
    });
    return mcpResultText(result).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Trigger an existing workflow by ID via n8n REST API */
export async function triggerWorkflow(
  workflowId: string,
  inputData?: Record<string, unknown>,
): Promise<WorkflowExecution | null> {
  const cfg = getN8nConfig();
  if (!cfg.apiKey) return null;
  try {
    const res = await fetch(`${cfg.host}/api/v1/workflows/${workflowId}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-API-KEY": cfg.apiKey,
      },
      body: JSON.stringify({ startNode: inputData }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { id: string; status: string; data: unknown };
    return { id: data.id, status: data.status as WorkflowExecution["status"], data: data.data };
  } catch {
    return null;
  }
}

/** Save a built workflow back to n8n */
export async function saveWorkflow(blueprint: WorkflowBlueprint): Promise<string | null> {
  const cfg = getN8nConfig();
  if (!cfg.apiKey) return null;
  try {
    const res = await fetch(`${cfg.host}/api/v1/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-API-KEY": cfg.apiKey,
      },
      body: JSON.stringify(blueprint),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { id: string };
    return data.id;
  } catch {
    return null;
  }
}

/** List all workflows in n8n */
export async function listWorkflows(): Promise<Array<{ id: string; name: string; active: boolean }>> {
  const cfg = getN8nConfig();
  if (!cfg.apiKey) return [];
  try {
    const res = await fetch(`${cfg.host}/api/v1/workflows`, {
      headers: { "X-N8N-API-KEY": cfg.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data: Array<{ id: string; name: string; active: boolean }> };
    return data.data ?? [];
  } catch {
    return [];
  }
}

// ── MAVIS Plugin registration ─────────────────────────────────────────────────

export const n8nPlugin = {
  id:          "n8n-workflows",
  name:        "n8n Workflow Engine",
  description: "Construct and execute n8n automation workflows from natural language via MAVIS",
  version:     "1.0.0",
  category:    "automation",
  isEnabled:   false,

  async onEnable() {
    const alive = await isMcpServerAlive(MCP_SERVERS.n8n);
    const cfg = getN8nConfig();
    console.log(
      `[n8nPlugin] MCP ${alive ? "online ✓" : "offline"}`,
      cfg.apiKey ? "| REST API configured ✓" : "| REST API not configured (set N8N_API_KEY)",
    );
  },

  async onDisable() {},
};

pluginRegistry.register(n8nPlugin);
