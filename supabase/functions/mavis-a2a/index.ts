// mavis-a2a — MAVIS as both A2A server and A2A client.
//
// Implements the Agent2Agent (A2A) protocol (JSON-RPC 2.0) so MAVIS can:
//   • Accept task delegations from external A2A-compatible agents (server role)
//   • Delegate tasks to other A2A-compatible agents (client role)
//
// Endpoints / actions:
//   GET  ?agentcard=true          → MAVIS AgentCard JSON
//   POST { action: "agent_card", agent_url }           → fetch a remote agent's card
//   POST { action: "call_a2a_agent", ... }             → call a remote A2A agent as a tool
//   POST { jsonrpc: "2.0", method: "tasks/send", ... } → inbound A2A task from external agent
//   POST { jsonrpc: "2.0", method: "tasks/get", ... }  → query task status
//   POST { jsonrpc: "2.0", method: "tasks/cancel", ... }→ cancel task
//
// Auth:
//   Accepts Bearer <service_role_key> (internal/cron) OR a valid Supabase user JWT.
//   Inbound A2A tasks without user JWT act on behalf of MAVIS_OPERATOR_MAIN_ID.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPERATOR_ID = Deno.env.get("MAVIS_OPERATOR_MAIN_ID") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── AgentCard ─────────────────────────────────────────────────────────────────

const MAVIS_AGENT_CARD = {
  name: "MAVIS",
  description:
    "Master Artificial Vantara Intelligence System — sovereign personal AI agent for Calvin Johnathon Watkins",
  url: `${SB_URL}/functions/v1/mavis-a2a`,
  version: "1.0.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  skills: [
    { id: "mavis.memory",   name: "Memory",         description: "Save and retrieve operator memories with semantic search" },
    { id: "mavis.plans",    name: "Plans",           description: "Create and advance multi-session plans" },
    { id: "mavis.search",   name: "Web Search",      description: "Search the web for current information" },
    { id: "mavis.calendar", name: "Calendar",        description: "Read and manage Google Calendar events" },
    { id: "mavis.tasks",    name: "Tasks",           description: "Create and complete tasks and quests" },
    { id: "mavis.code",     name: "Code Execution",  description: "Execute JavaScript/TypeScript and Python in sandboxed environments" },
    { id: "mavis.email",    name: "Email",           description: "Send emails via Gmail or Resend" },
    { id: "mavis.note",     name: "Notes",           description: "Create notes and vault entries" },
  ],
};

// ── Skill → mavis-actions type map ───────────────────────────────────────────

const SKILL_TO_ACTION: Record<string, string> = {
  "mavis.memory":   "memory_agent",
  "mavis.plans":    "advance_plan",
  "mavis.search":   "web_search",
  "mavis.calendar": "calendar_agent",
  "mavis.tasks":    "create_task",
  "mavis.code":     "execute_code",
  "mavis.email":    "send_email",
  "mavis.note":     "create_note",
};

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function rpcOk(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcErr(id: string | number | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Auth: resolve userId from request ────────────────────────────────────────

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  // Service-role token → use operator default
  if (token === SB_SRK) return OPERATOR_ID || null;
  // Try Supabase user JWT
  const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
  const { data: { user } } = await sb.auth.getUser(token);
  return user?.id ?? null;
}

// ── A2A task: execute via mavis-actions ───────────────────────────────────────

async function executeSkill(
  skillId: string,
  input: unknown,
  userId: string,
): Promise<{ ok: boolean; result: unknown; error?: string }> {
  const actionType = SKILL_TO_ACTION[skillId] ?? "create_note";
  const params: Record<string, unknown> =
    input && typeof input === "object" ? (input as Record<string, unknown>) : { query: String(input ?? "") };

  try {
    const res = await fetch(`${SB_URL}/functions/v1/mavis-actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SB_SRK}`,
      },
      body: JSON.stringify({ userId, actions: [{ type: actionType, params }] }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, result: null, error: data?.error ?? `HTTP ${res.status}` };
    const actionResult = (data as any)?.results?.[0] ?? data;
    return { ok: true, result: actionResult };
  } catch (e: any) {
    return { ok: false, result: null, error: e.message };
  }
}

// ── tasks/send ────────────────────────────────────────────────────────────────

async function handleTasksSend(
  params: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
  userId: string,
  rpcId: string | number | null,
): Promise<Response> {
  const taskId = (params.id as string) ?? crypto.randomUUID();
  const skillId = (params.skill_id as string) ?? "mavis.note";
  const callingAgentUrl = (params.metadata as any)?.agent_url ?? null;
  const sessionId = (params.metadata as any)?.session_id ?? null;

  // Extract text input from A2A message parts or plain string
  let input: unknown = params.input ?? params.message;
  if (input && typeof input === "object" && Array.isArray((input as any).parts)) {
    const parts = (input as any).parts as Array<{ type: string; text?: string }>;
    input = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
  } else if (input && typeof input === "object" && (input as any).content) {
    input = (input as any).content;
  }

  // Persist task as pending
  const { error: insertErr } = await sb.from("mavis_a2a_tasks").insert({
    id: taskId,
    user_id: userId,
    session_id: sessionId,
    calling_agent_url: callingAgentUrl,
    skill_id: skillId,
    input,
    status: "running",
  });

  if (insertErr) {
    return jsonResp(rpcErr(rpcId, -32603, "DB insert failed", insertErr.message), 500);
  }

  // Execute skill
  const { ok, result, error: execErr } = await executeSkill(skillId, input, userId);
  const finalStatus = ok ? "completed" : "failed";

  await sb.from("mavis_a2a_tasks").update({
    status: finalStatus,
    result: ok ? result : null,
    error: execErr ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", taskId);

  const taskResult = {
    id: taskId,
    status: { state: finalStatus, timestamp: new Date().toISOString() },
    skill_id: skillId,
    result: ok ? result : null,
    error: execErr ?? null,
  };

  return jsonResp(rpcOk(rpcId, taskResult));
}

// ── tasks/get ─────────────────────────────────────────────────────────────────

async function handleTasksGet(
  params: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
  rpcId: string | number | null,
): Promise<Response> {
  const taskId = params.id as string;
  if (!taskId) return jsonResp(rpcErr(rpcId, -32602, "params.id required"), 400);

  const { data: task, error } = await sb
    .from("mavis_a2a_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (error || !task) {
    return jsonResp(rpcErr(rpcId, -32603, "Task not found"), 404);
  }

  return jsonResp(rpcOk(rpcId, {
    id: task.id,
    status: { state: task.status, timestamp: task.updated_at ?? task.created_at },
    skill_id: task.skill_id,
    result: task.result,
    error: task.error,
    created_at: task.created_at,
  }));
}

// ── tasks/cancel ──────────────────────────────────────────────────────────────

async function handleTasksCancel(
  params: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
  rpcId: string | number | null,
): Promise<Response> {
  const taskId = params.id as string;
  if (!taskId) return jsonResp(rpcErr(rpcId, -32602, "params.id required"), 400);

  const { data: task, error } = await sb
    .from("mavis_a2a_tasks")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .in("status", ["pending", "running"])
    .select()
    .maybeSingle();

  if (error || !task) {
    return jsonResp(rpcErr(rpcId, -32603, "Task not found or not cancellable"), 404);
  }

  return jsonResp(rpcOk(rpcId, {
    id: task.id,
    status: { state: "cancelled", timestamp: new Date().toISOString() },
  }));
}

// ── A2A Client: call a remote agent ──────────────────────────────────────────

async function callRemoteAgent(
  agentUrl: string,
  skillId: string,
  input: unknown,
): Promise<{ ok: boolean; result: unknown; error?: string }> {
  const taskId = crypto.randomUUID();
  const body = {
    jsonrpc: "2.0",
    id: taskId,
    method: "tasks/send",
    params: {
      id: taskId,
      skill_id: skillId,
      message: { role: "user", parts: [{ type: "text", text: typeof input === "string" ? input : JSON.stringify(input) }] },
    },
  };

  try {
    const res = await fetch(agentUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok || data?.error) {
      return { ok: false, result: null, error: data?.error?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, result: data?.result };
  } catch (e: any) {
    return { ok: false, result: null, error: e.message };
  }
}

async function fetchAgentCard(agentUrl: string): Promise<{ ok: boolean; card?: unknown; error?: string }> {
  try {
    // Try ?agentcard=true first (our convention), then /.well-known/agent.json
    const urlObj = new URL(agentUrl);
    urlObj.searchParams.set("agentcard", "true");
    let res = await fetch(urlObj.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      // Fallback: try /.well-known/agent.json on the host
      const wellKnown = new URL("/.well-known/agent.json", agentUrl);
      res = await fetch(wellKnown.toString(), { signal: AbortSignal.timeout(10_000) });
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const card = await res.json();
    return { ok: true, card };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  // AgentCard discovery (GET or ?agentcard=true)
  if (req.method === "GET" || url.searchParams.get("agentcard") === "true") {
    return jsonResp(MAVIS_AGENT_CARD);
  }

  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp(rpcErr(null, -32700, "Parse error"), 400);
  }

  // ── Non-RPC actions (A2A client mode) ────────────────────────────────────

  if (body.action === "agent_card") {
    const agentUrl = body.agent_url as string;
    if (!agentUrl) return jsonResp({ error: "agent_url required" }, 400);
    const { ok, card, error } = await fetchAgentCard(agentUrl);
    if (!ok) return jsonResp({ error }, 502);
    return jsonResp({ card });
  }

  if (body.action === "call_a2a_agent") {
    const { agent_url, skill_id, input, userId } = body as Record<string, string>;
    if (!agent_url) return jsonResp({ error: "agent_url required" }, 400);
    if (!skill_id)  return jsonResp({ error: "skill_id required" }, 400);
    const { ok, result, error } = await callRemoteAgent(agent_url, skill_id, input);
    return jsonResp({ ok, result, error: error ?? null });
  }

  // ── JSON-RPC 2.0 inbound (A2A server mode) ───────────────────────────────

  const rpcId = (body.id as string | number | null) ?? null;
  const method = body.method as string | undefined;
  const params = (body.params ?? {}) as Record<string, unknown>;

  if (!method) {
    return jsonResp(rpcErr(rpcId, -32600, "Invalid Request — missing method"), 400);
  }

  // Resolve the acting user
  const userId = await resolveUserId(req) ?? OPERATOR_ID;
  if (!userId) {
    return jsonResp(rpcErr(rpcId, -32600, "Could not resolve user_id — provide a valid Bearer token"), 401);
  }

  const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

  try {
    switch (method) {
      case "tasks/send":
        return await handleTasksSend(params, sb, userId, rpcId);

      case "tasks/get":
        return await handleTasksGet(params, sb, rpcId);

      case "tasks/cancel":
        return await handleTasksCancel(params, sb, rpcId);

      case "agent/authenticatedExtendedCard":
        return jsonResp(rpcOk(rpcId, { ...MAVIS_AGENT_CARD, authenticated: true }));

      default:
        return jsonResp(rpcErr(rpcId, -32601, `Method not found: ${method}`), 404);
    }
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-a2a]", message);
    return jsonResp(rpcErr(rpcId, -32603, "Internal error", message), 500);
  }
});
