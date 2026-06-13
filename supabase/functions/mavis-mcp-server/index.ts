// MAVIS MCP Server — Model Context Protocol HTTP transport
// Exposes MAVIS tools to Claude Desktop, Cursor, Windsurf, and any MCP client.
//
// Protocol: JSON-RPC 2.0 over HTTP (MCP spec 2024-11-05)
// Auth: x-mavis-api-key header (SHA-256 hashed, looked up in mavis_api_keys)
//
// Add to Claude Desktop config:
// {
//   "mcpServers": {
//     "mavis": {
//       "url": "https://<project>.supabase.co/functions/v1/mavis-mcp-server",
//       "headers": { "x-mavis-api-key": "mk_live_..." }
//     }
//   }
// }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-mavis-api-key",
};

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// ── MCP Tool definitions ──────────────────────────────────────────────────────

const MCP_TOOLS = [
  {
    name: "ask_mavis",
    description:
      "Ask MAVIS a question or request analysis. MAVIS has access to your knowledge base, memory, and full context. Use ARCH mode for deep reasoning, CODEX for knowledge synthesis, AGENT for tool execution.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Your question or request" },
        mode: {
          type: "string",
          enum: ["PRIME", "ARCH", "CODEX", "SOVEREIGN", "AGENT", "RESEARCH"],
          description: "MAVIS mode. Default: ARCH",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "search_memory",
    description:
      "Search MAVIS's semantic memory using natural language. Returns the most relevant stored memories, notes, and conversation history.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query" },
        limit: { type: "number", description: "Max results (1-20, default 8)" },
      },
      required: ["query"],
    },
  },
  {
    name: "add_memory",
    description:
      "Store information in MAVIS's long-term memory. Use this to save important context, decisions, or facts that MAVIS should remember.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to store" },
        importance: {
          type: "number",
          description: "Importance score 1-10 (default: auto-scored)",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "create_task",
    description:
      "Create a task in MAVIS's task management system. Tasks appear in the operator's dashboard and can trigger autonomous execution.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Detailed description" },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Priority level. Default: medium",
        },
        type: { type: "string", description: "Task type (goal, build, review, etc.)" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_quests",
    description:
      "Get the operator's active quests from MAVIS. Quests are major objectives with XP rewards and progress tracking.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "completed", "paused"],
          description: "Filter by status. Default: active",
        },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: [],
    },
  },
  {
    name: "run_agent",
    description:
      "Run MAVIS in AGENT mode to autonomously execute a complex task using tools (web search, calendar, contacts, code execution, SMS, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The goal for MAVIS AGENT to accomplish" },
      },
      required: ["goal"],
    },
  },
];

// ── Auth: SHA-256 API key lookup ──────────────────────────────────────────────

async function resolveUserId(apiKey: string): Promise<string | null> {
  if (!apiKey) return null;
  try {
    const keyBytes = new TextEncoder().encode(apiKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", keyBytes);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    const { data } = await sb
      .from("mavis_api_keys")
      .select("user_id")
      .eq("key_hash", hashHex)
      .eq("is_active", true)
      .maybeSingle();

    return data?.user_id ?? null;
  } catch {
    return null;
  }
}

// ── Tool executors ────────────────────────────────────────────────────────────

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function execAskMavis(
  userId: string,
  question: string,
  mode = "ARCH",
): Promise<string> {
  if (!ANTHROPIC_KEY) return "MAVIS: ANTHROPIC_API_KEY not configured.";

  const system =
    "You are MAVIS — a sovereign-class AI assistant. " +
    "Answer the question directly, precisely, and comprehensively. " +
    "Mode: " + mode;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: question }],
    }),
  });

  if (!res.ok) return `MAVIS error: ${res.status}`;
  const d = await res.json();
  const blocks = Array.isArray(d.content) ? d.content : [];
  return blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "No response";
}

async function execSearchMemory(userId: string, query: string, limit = 8): Promise<string> {
  if (!Deno.env.get("OPENAI_API")) {
    // Fallback: text search in mavis_memory
    const { data } = await sb()
      .from("mavis_memory")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .ilike("content", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data?.length) return "No memories found matching that query.";
    return data.map((m: any) => `[${m.role}] ${m.content}`).join("\n\n");
  }

  // Semantic search via OpenAI embeddings + pgvector
  const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API")}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
  });
  if (!embedRes.ok) return "Memory search unavailable.";
  const embedData = await embedRes.json();
  const embedding = embedData.data?.[0]?.embedding;

  const { data } = await sb().rpc("match_mavis_notes", {
    query_embedding: embedding,
    match_threshold: 0.5,
    match_count: limit,
    p_user_id: userId,
  });
  if (!data?.length) return "No relevant memories found.";
  return data.map((m: any) => `• ${m.content} (score: ${m.similarity?.toFixed(2)})`).join("\n");
}

async function execAddMemory(
  userId: string,
  content: string,
  importance?: number,
): Promise<string> {
  const score = importance ?? Math.min(9, 4 + (content.length > 200 ? 1 : 0));
  const { error } = await sb().from("mavis_memory").insert({
    user_id: userId,
    role: "assistant",
    content: `[MCP MEMORY] ${content}`,
    importance_score: score,
  });
  if (error) return `Failed to store memory: ${error.message}`;
  return `Memory stored with importance ${score}/10.`;
}

async function execCreateTask(
  userId: string,
  title: string,
  description?: string,
  priority = "medium",
  type = "goal",
): Promise<string> {
  const { data, error } = await sb()
    .from("mavis_tasks")
    .insert({
      user_id: userId,
      title,
      description: description ?? "",
      priority,
      type,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return `Failed to create task: ${error.message}`;
  return `Task created (ID: ${data.id}): "${title}" [${priority} priority]`;
}

async function execListQuests(
  userId: string,
  status = "active",
  limit = 10,
): Promise<string> {
  const { data, error } = await sb()
    .from("quests")
    .select("title, description, status, xp_reward, deadline")
    .eq("user_id", userId)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return `Failed to fetch quests: ${error.message}`;
  if (!data?.length) return `No ${status} quests found.`;
  return data
    .map(
      (q: any) =>
        `**${q.title}** (${q.status}) — ${q.xp_reward ?? 0} XP` +
        (q.deadline ? ` | Due: ${q.deadline.slice(0, 10)}` : "") +
        (q.description ? `\n  ${q.description.slice(0, 120)}` : ""),
    )
    .join("\n\n");
}

async function execRunAgent(userId: string, goal: string): Promise<string> {
  const supabaseUrl = SB_URL;
  const serviceKey = SB_KEY;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/mavis-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        messages: [{ role: "user", content: goal }],
        systemPrompt: "You are MAVIS in AGENT mode. Complete the task using your available tools.",
      }),
    });
    if (!res.ok) return `Agent execution failed: ${res.status}`;
    // SSE stream — read first data event
    const text = await res.text();
    const match = text.match(/data: ({.*})/);
    if (match) {
      const evt = JSON.parse(match[1]);
      return evt.content ?? evt.text ?? "Agent task queued.";
    }
    return "Agent task initiated. Check /agents for progress.";
  } catch (err: any) {
    return `Agent error: ${err.message}`;
  }
}

// ── MCP JSON-RPC handler ──────────────────────────────────────────────────────

function jsonrpc(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Auth ───────────────────────────────────────────────────────────────────
  const apiKey = req.headers.get("x-mavis-api-key") ?? "";
  const userId = await resolveUserId(apiKey);
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Unauthorized. Provide a valid x-mavis-api-key header." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Parse JSON-RPC body ────────────────────────────────────────────────────
  let rpc: any;
  try {
    rpc = await req.json();
  } catch {
    return jsonrpcError(null, -32700, "Parse error");
  }

  const { jsonrpc: ver, id, method, params } = rpc;
  if (ver !== "2.0") return jsonrpcError(id, -32600, "Invalid Request");

  // ── Method routing ─────────────────────────────────────────────────────────

  if (method === "initialize") {
    return jsonrpc(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "MAVIS", version: "2.0.0" },
      instructions:
        "MAVIS is a sovereign-class AI system. Use ask_mavis for general queries, search_memory to recall context, and run_agent for autonomous multi-step tasks.",
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (method === "tools/list") {
    return jsonrpc(id, { tools: MCP_TOOLS });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments ?? {};

    let resultText: string;
    try {
      switch (toolName) {
        case "ask_mavis":
          resultText = await execAskMavis(userId, String(args.question ?? ""), String(args.mode ?? "ARCH"));
          break;
        case "search_memory":
          resultText = await execSearchMemory(userId, String(args.query ?? ""), Number(args.limit ?? 8));
          break;
        case "add_memory":
          resultText = await execAddMemory(userId, String(args.content ?? ""), args.importance != null ? Number(args.importance) : undefined);
          break;
        case "create_task":
          resultText = await execCreateTask(
            userId,
            String(args.title ?? ""),
            args.description ? String(args.description) : undefined,
            args.priority ? String(args.priority) : "medium",
            args.type ? String(args.type) : "goal",
          );
          break;
        case "list_quests":
          resultText = await execListQuests(
            userId,
            args.status ? String(args.status) : "active",
            Number(args.limit ?? 10),
          );
          break;
        case "run_agent":
          resultText = await execRunAgent(userId, String(args.goal ?? ""));
          break;
        default:
          return jsonrpcError(id, -32601, `Tool not found: ${toolName}`);
      }
    } catch (err: any) {
      resultText = `Error: ${err.message ?? "Tool execution failed"}`;
    }

    return jsonrpc(id, {
      content: [{ type: "text", text: resultText }],
    });
  }

  if (method === "ping") {
    return jsonrpc(id, {});
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`);
});
