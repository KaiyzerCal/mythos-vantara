/**
 * mavis-a2a-gateway — A2A (Agent-to-Agent) Protocol v1.2 gateway.
 *
 * Implements Google's open A2A standard for agent federation via JSON-RPC 2.0.
 * Exposes MAVIS's Agent Card and accepts tasks from external agents.
 *
 * Routes:
 *   GET  /.well-known/agent.json  → Agent Card (discovery)
 *   POST /                        → JSON-RPC 2.0 (tasks/send, tasks/get, tasks/cancel)
 *
 * Required Supabase secrets: none (uses service role for DB writes)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── MAVIS Agent Card ─────────────────────────────────────────────────────────

const MAVIS_AGENT_CARD = {
  name: "MAVIS",
  description:
    "Sovereign AI life-OS assistant. Capabilities: knowledge synthesis, quest management, journaling, health tracking, code analysis, creative generation.",
  version: "1.0.0",
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  skills: [
    {
      id: "knowledge_query",
      name: "Knowledge Query",
      description: "Search and synthesize from user's knowledge base",
    },
    {
      id: "quest_manage",
      name: "Quest Management",
      description: "Create, update, track quests and tasks",
    },
    {
      id: "journal_entry",
      name: "Journal Entry",
      description: "Create journal entries with emotion tagging",
    },
    {
      id: "code_review",
      name: "Code Review",
      description: "Analyze and review code",
    },
    {
      id: "image_gen",
      name: "Image Generation",
      description: "Generate images with Imagen 4 or DALL-E 3",
    },
  ],
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
};

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

function rpcSuccess(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

// ── Task handlers ────────────────────────────────────────────────────────────

interface A2ATaskParams {
  id?: string;
  skill_id?: string;
  message?: {
    role?: string;
    parts?: Array<{ type: string; text?: string }>;
    content?: string;
  };
  metadata?: Record<string, unknown>;
}

async function handleTasksSend(
  params: A2ATaskParams,
  sb: ReturnType<typeof createClient>,
  requestUserId?: string,
): Promise<unknown> {
  const taskId = params.id ?? crypto.randomUUID();
  const skillId = params.skill_id ?? "knowledge_query";
  const externalAgentId = (params.metadata?.agent_id as string) ?? null;

  // Extract message text from A2A parts format
  let inputMessage = "";
  if (params.message?.parts) {
    inputMessage = params.message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  } else if (typeof params.message?.content === "string") {
    inputMessage = params.message.content;
  } else if (typeof params.message === "string") {
    inputMessage = params.message as string;
  }

  if (!inputMessage) inputMessage = "(empty task)";

  // Determine user_id: prefer explicit user_id in metadata, else fallback to service account
  const userId = requestUserId ?? (params.metadata?.user_id as string) ?? null;
  if (!userId) {
    return rpcError(null, -32600, "user_id required in task metadata");
  }

  const now = new Date().toISOString();

  const { data: inserted, error: dbErr } = await sb
    .from("a2a_tasks")
    .insert({
      id: taskId,
      user_id: userId,
      external_agent_id: externalAgentId,
      skill_id: skillId,
      status: "submitted",
      input_message: inputMessage,
      artifacts: [],
    })
    .select()
    .single();

  if (dbErr) {
    console.error("[a2a-gateway] DB insert error:", dbErr.message);
    return rpcError(null, -32603, "Failed to create task", dbErr.message);
  }

  return {
    id: inserted.id,
    status: {
      state: "submitted",
      timestamp: now,
    },
    artifacts: [],
    metadata: {
      skill_id: skillId,
      external_agent_id: externalAgentId,
    },
  };
}

async function handleTasksGet(
  params: { id: string },
  sb: ReturnType<typeof createClient>,
): Promise<unknown> {
  if (!params.id) {
    return { error: "id required" };
  }

  const { data: task, error: dbErr } = await sb
    .from("a2a_tasks")
    .select("*")
    .eq("id", params.id)
    .single();

  if (dbErr || !task) {
    return { error: "Task not found", id: params.id };
  }

  return {
    id: task.id,
    status: {
      state: task.status,
      timestamp: task.updated_at ?? task.created_at,
    },
    artifacts: task.artifacts ?? [],
    output_message: task.output_message ?? null,
    metadata: {
      skill_id: task.skill_id,
      external_agent_id: task.external_agent_id,
      created_at: task.created_at,
      completed_at: task.completed_at,
    },
  };
}

async function handleTasksCancel(
  params: { id: string },
  sb: ReturnType<typeof createClient>,
): Promise<unknown> {
  if (!params.id) {
    return { error: "id required" };
  }

  const { data: task, error: dbErr } = await sb
    .from("a2a_tasks")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();

  if (dbErr || !task) {
    return { error: "Task not found or could not be cancelled", id: params.id };
  }

  return {
    id: task.id,
    status: {
      state: "cancelled",
      timestamp: new Date().toISOString(),
    },
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);

  // A2A Agent Discovery — must be publicly accessible, no auth required
  if (req.method === "GET" && (url.pathname.endsWith("/.well-known/agent.json") || url.pathname === "/")) {
    return new Response(JSON.stringify(MAVIS_AGENT_CARD), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // JSON-RPC endpoint — POST /
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let rpcBody: { jsonrpc?: string; id?: string | number; method?: string; params?: unknown };
  try {
    rpcBody = await req.json();
  } catch {
    return new Response(
      JSON.stringify(rpcError(null, -32700, "Parse error")),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { id: rpcId = null, method, params } = rpcBody;

  if (!method) {
    return new Response(
      JSON.stringify(rpcError(rpcId, -32600, "Invalid Request — missing method")),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Soft auth — extract user if bearer token present, not hard-required for A2A
  const sb = createClient(SB_URL, SB_KEY);
  let requestUserId: string | undefined;
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const { data: { user } } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    requestUserId = user?.id;
  }

  try {
    let result: unknown;

    switch (method) {
      case "tasks/send":
        result = await handleTasksSend(params as A2ATaskParams, sb, requestUserId);
        break;

      case "tasks/get":
        result = await handleTasksGet(params as { id: string }, sb);
        break;

      case "tasks/cancel":
        result = await handleTasksCancel(params as { id: string }, sb);
        break;

      case "agent/authenticatedExtendedCard":
        // Return extended card with auth — same as public card for now
        result = { ...MAVIS_AGENT_CARD, authenticated: true };
        break;

      default:
        return new Response(
          JSON.stringify(rpcError(rpcId, -32601, `Method not found: ${method}`)),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    // If result itself contains an error key (from our handlers), wrap as RPC error
    if (result && typeof result === "object" && "error" in (result as object)) {
      const r = result as { error: string };
      return new Response(
        JSON.stringify(rpcError(rpcId, -32603, r.error)),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify(rpcSuccess(rpcId, result)),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-a2a-gateway]", message);
    return new Response(
      JSON.stringify(rpcError(rpcId, -32603, "Internal error", message)),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
