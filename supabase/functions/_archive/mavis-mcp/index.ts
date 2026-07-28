import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── MCP Tool Definitions ────────────────────────────────────────────────────
const MAVIS_TOOLS = [
  {
    name: "web_search",
    description: "Search the web for current information",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "memory_save",
    description: "Save a memory to MAVIS long-term memory",
    inputSchema: {
      type: "object",
      properties: {
        memory: { type: "string" },
        importance: { type: "number", minimum: 1, maximum: 10 },
      },
      required: ["memory"],
    },
  },
  {
    name: "memory_retrieve",
    description: "Retrieve memories from MAVIS long-term memory",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        days_back: { type: "number" },
        semantic: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_task",
    description: "Create a task or habit in MAVIS",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string", enum: ["task", "habit"] },
        xp_reward: { type: "number" },
      },
      required: ["title"],
    },
  },
  {
    name: "create_quest",
    description: "Create a quest in MAVIS",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        type: { type: "string", enum: ["daily", "side", "main", "epic"] },
        difficulty: { type: "string" },
        xp_reward: { type: "number" },
      },
      required: ["title"],
    },
  },
  {
    name: "create_note",
    description: "Create a journal entry or vault note",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "generate_plan",
    description: "Generate a multi-session action plan for a goal",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        context: { type: "string" },
        timeframe: { type: "string" },
      },
      required: ["goal"],
    },
  },
  {
    name: "send_telegram",
    description: "Send a Telegram message to the operator",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        parse_mode: { type: "string", enum: ["HTML", "Markdown"] },
      },
      required: ["message"],
    },
  },
  {
    name: "send_email",
    description: "Send an email via Gmail",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "execute_code",
    description: "Execute JavaScript/TypeScript code in a sandboxed E2B environment",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        language: { type: "string", enum: ["javascript", "typescript", "python"] },
      },
      required: ["code"],
    },
  },
  {
    name: "log_revenue",
    description: "Log a revenue transaction",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        source: { type: "string" },
        description: { type: "string" },
        currency: { type: "string" },
      },
      required: ["amount", "source"],
    },
  },
  {
    name: "calendar_events",
    description: "Get upcoming calendar events",
    inputSchema: {
      type: "object",
      properties: {
        days_ahead: { type: "number" },
        max_results: { type: "number" },
      },
    },
  },
  {
    name: "get_world_model",
    description: "Get the current MAVIS world model — synthesized operator state snapshot",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "route_event",
    description: "Route an external event through MAVIS for classification and action",
    inputSchema: {
      type: "object",
      properties: {
        event_type: { type: "string" },
        source: { type: "string" },
        payload: { type: "object" },
        notify: { type: "boolean" },
      },
      required: ["event_type", "source", "payload"],
    },
  },
  {
    name: "compare_periods",
    description: "Compare two time periods of operator memory to identify what changed",
    inputSchema: {
      type: "object",
      properties: {
        period_a_start_days: { type: "number" },
        period_a_end_days: { type: "number" },
        period_b_days: { type: "number" },
        topic: { type: "string" },
      },
    },
  },
];

// ── Tool → mavis-actions mapping ────────────────────────────────────────────
function mapToolToAction(
  toolName: string,
  args: Record<string, unknown>
): { type: string; params: Record<string, unknown> } {
  switch (toolName) {
    case "web_search":
      return { type: "web_search", params: args };
    case "memory_save":
      return { type: "memory_agent", params: { action: "save_memory", ...args } };
    case "memory_retrieve":
      return { type: "memory_agent", params: { action: "retrieve_memories", ...args } };
    case "create_task":
      return { type: "create_task", params: args };
    case "create_quest":
      return { type: "create_quest", params: args };
    case "create_note":
      return { type: "create_note", params: args };
    case "generate_plan":
      return { type: "generate_plan", params: args };
    case "send_telegram":
      return { type: "send_telegram", params: args };
    case "send_email":
      return { type: "send_email", params: args };
    case "execute_code":
      return { type: "execute_code", params: args };
    case "log_revenue":
      return { type: "log_revenue", params: args };
    case "calendar_events":
      return { type: "calendar_agent", params: { action: "get_all_events", ...args } };
    case "get_world_model":
      return { type: "world_model", params: { action: "synthesize" } };
    case "route_event":
      return { type: "route_event", params: args };
    case "compare_periods":
      return { type: "memory_agent", params: { action: "compare_periods", ...args } };
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────
function jsonRpcSuccess(id: unknown, result: unknown) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, result }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── Auth check ───────────────────────────────────────────────────────────────
function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  // Accept service role key (internal calls) or any non-empty JWT
  return token.length > 0;
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Agent card / server info endpoint
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("agentcard") === "true") {
      return new Response(
        JSON.stringify({
          name: "mavis-mcp",
          version: "1.0.0",
          description: "MAVIS MCP server — exposes all MAVIS capabilities as MCP-callable tools",
          protocolVersion: "2024-11-05",
          tools: MAVIS_TOOLS.map((t) => ({ name: t.name, description: t.description })),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ status: "ok", server: "mavis-mcp" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth guard
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse JSON-RPC body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { jsonrpc, id, method, params } = body as {
    jsonrpc: string;
    id: unknown;
    method: string;
    params?: Record<string, unknown>;
  };

  if (jsonrpc !== "2.0") {
    return jsonRpcError(id ?? null, -32600, "Invalid Request — jsonrpc must be '2.0'");
  }

  // ── initialize ─────────────────────────────────────────────────────────────
  if (method === "initialize") {
    return jsonRpcSuccess(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "mavis-mcp", version: "1.0.0" },
    });
  }

  // ── ping ───────────────────────────────────────────────────────────────────
  if (method === "ping") {
    return jsonRpcSuccess(id, {});
  }

  // ── tools/list ─────────────────────────────────────────────────────────────
  if (method === "tools/list") {
    return jsonRpcSuccess(id, { tools: MAVIS_TOOLS });
  }

  // ── tools/call ─────────────────────────────────────────────────────────────
  if (method === "tools/call") {
    const toolName = String((params as any)?.name ?? "");
    const toolArgs = ((params as any)?.arguments ?? {}) as Record<string, unknown>;

    if (!toolName) {
      return jsonRpcError(id, -32602, "Invalid params — 'name' is required");
    }

    // Resolve userId: prefer X-Mavis-User-Id header, fall back to env default
    const userId =
      req.headers.get("x-mavis-user-id") ??
      Deno.env.get("MAVIS_OPERATOR_MAIN_ID") ??
      "";

    if (!userId) {
      return jsonRpcError(id, -32602, "Unable to resolve userId — provide X-Mavis-User-Id header or set MAVIS_OPERATOR_MAIN_ID");
    }

    let mappedAction: { type: string; params: Record<string, unknown> };
    try {
      mappedAction = mapToolToAction(toolName, toolArgs);
    } catch (err) {
      return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
    }

    try {
      const actionRes = await fetch(`${SB_URL}/functions/v1/mavis-actions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SB_SRK}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          actions: [{ type: mappedAction.type, params: mappedAction.params }],
        }),
      });

      const resultText = await actionRes.text();
      let resultData: unknown;
      try {
        resultData = JSON.parse(resultText);
      } catch {
        resultData = resultText;
      }

      if (!actionRes.ok) {
        return jsonRpcSuccess(id, {
          content: [{ type: "text", text: JSON.stringify(resultData) }],
          isError: true,
        });
      }

      return jsonRpcSuccess(id, {
        content: [{ type: "text", text: JSON.stringify(resultData) }],
        isError: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonRpcSuccess(id, {
        content: [{ type: "text", text: `Error calling mavis-actions: ${message}` }],
        isError: true,
      });
    }
  }

  // ── Unknown method ─────────────────────────────────────────────────────────
  return jsonRpcError(id ?? null, -32601, "Method not found");
});
