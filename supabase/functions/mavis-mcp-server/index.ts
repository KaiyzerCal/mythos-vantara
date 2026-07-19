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
  {
    name: "complete_quest",
    description: "Mark a quest as completed by its ID.",
    inputSchema: {
      type: "object",
      properties: { quest_id: { type: "string", description: "Quest UUID" } },
      required: ["quest_id"],
    },
  },
  {
    name: "list_tasks",
    description: "List the user's tasks with optional status filter.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "in_progress", "done"], description: "Filter by status" },
        limit:  { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "list_goals",
    description: "Retrieve the user's goals (active by default).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "completed", "paused"], description: "Default: active" },
      },
    },
  },
  {
    name: "log_expense",
    description: "Log a new expense to the finance ledger.",
    inputSchema: {
      type: "object",
      properties: {
        description:  { type: "string" },
        amount:       { type: "number" },
        currency:     { type: "string", description: "Default: USD" },
        category:     { type: "string", description: "e.g. software, food, travel" },
        expense_date: { type: "string", description: "YYYY-MM-DD, defaults to today" },
      },
      required: ["description", "amount"],
    },
  },
  {
    name: "get_revenue_summary",
    description: "Get a combined revenue summary from Stripe and Gumroad.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_journal",
    description: "Retrieve recent journal entries.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 10" } },
    },
  },
  {
    name: "create_journal",
    description: "Create a new journal entry.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        mood:    { type: "string", description: "e.g. focused, anxious, energized" },
        tags:    { type: "array", items: { type: "string" } },
      },
      required: ["content"],
    },
  },
  {
    name: "get_user_profile",
    description: "Return the synthesized MAVIS user profile (personality overview, communication style, key context, preferences).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "post_to_social",
    description: "Post or schedule content to a social platform via MAVIS NORA.",
    inputSchema: {
      type: "object",
      properties: {
        content:     { type: "string", description: "The post text" },
        platform:    { type: "string", enum: ["twitter", "linkedin", "instagram", "discord"] },
        schedule_at: { type: "string", description: "ISO datetime to schedule (omit to post now)" },
      },
      required: ["content", "platform"],
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
  if (!(Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY"))) {
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${(Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY"))}` },
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

// ── Extended tool executors ───────────────────────────────────────────────────

async function execCompleteQuest(userId: string, questId: string): Promise<string> {
  const { error } = await sb().from("quests")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", questId).eq("user_id", userId);
  if (error) return `Failed: ${error.message}`;
  return `Quest ${questId} marked completed.`;
}

async function execListTasks(userId: string, status?: string, limit = 20): Promise<string> {
  let q = sb().from("tasks").select("id,title,status,priority,due_date,tags").eq("user_id", userId);
  if (status) q = q.eq("status", status);
  q = q.order("created_at", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) return `Failed: ${error.message}`;
  if (!data?.length) return "No tasks found.";
  return data.map((t: any) =>
    `• [${t.status}] ${t.title}${t.priority ? ` (${t.priority})` : ""}${t.due_date ? ` — due ${t.due_date.slice(0,10)}` : ""}`
  ).join("\n");
}

async function execListGoals(userId: string, status = "active"): Promise<string> {
  const { data, error } = await sb().from("mavis_goals")
    .select("id,objective,context,status").eq("user_id", userId).eq("status", status);
  if (error) return `Failed: ${error.message}`;
  if (!data?.length) return `No ${status} goals.`;
  return data.map((g: any) => `• ${g.objective}${g.context ? `: ${String(g.context).slice(0, 100)}` : ""}`).join("\n");
}

async function execLogExpense(userId: string, description: string, amount: number, currency = "USD", category = "other", expenseDate?: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb().from("mavis_expenses").insert({
    user_id: userId, description, amount, currency, category,
    expense_date: expenseDate ?? today, source: "mcp",
  }).select("id").single();
  if (error) return `Failed: ${error.message}`;
  return `Expense logged (ID: ${data.id}): ${currency} ${amount} — ${description}`;
}

async function execGetRevenueSummary(userId: string): Promise<string> {
  const [stripeRes, gumroadRes] = await Promise.all([
    sb().from("stripe_revenue").select("amount").eq("user_id", userId).limit(100),
    sb().from("gumroad_sales").select("price").eq("user_id", userId).limit(100),
  ]);
  const stripeTotal  = (stripeRes.data  ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const gumroadTotal = (gumroadRes.data ?? []).reduce((s: number, r: any) => s + Number(r.price),  0);
  return `Revenue summary:\n• Stripe: $${stripeTotal.toFixed(2)}\n• Gumroad: $${gumroadTotal.toFixed(2)}\n• Combined: $${(stripeTotal + gumroadTotal).toFixed(2)}`;
}

async function execListJournal(userId: string, limit = 10): Promise<string> {
  const { data, error } = await sb().from("journal_entries")
    .select("id,content,mood,tags,created_at").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return `Failed: ${error.message}`;
  if (!data?.length) return "No journal entries.";
  return data.map((j: any) =>
    `[${j.created_at?.slice(0,10)}${j.mood ? ` • ${j.mood}` : ""}]\n${String(j.content).slice(0, 200)}`
  ).join("\n\n");
}

async function execCreateJournal(userId: string, content: string, mood?: string, tags?: string[]): Promise<string> {
  const { data, error } = await sb().from("journal_entries").insert({
    user_id: userId, content, mood: mood ?? null, tags: tags ?? [],
  }).select("id").single();
  if (error) return `Failed: ${error.message}`;
  return `Journal entry created (ID: ${data.id}).`;
}

async function execGetUserProfile(userId: string): Promise<string> {
  const { data, error } = await sb().from("mavis_user_profile")
    .select("profile_md,communication_style,key_context,preferences,topics_of_interest,updated_at")
    .eq("user_id", userId).maybeSingle();
  if (error) return `Failed: ${error.message}`;
  if (!data) return "No profile synthesized yet. Send the user to MAVIS chat to generate one.";
  return [
    `## MAVIS User Profile (updated ${data.updated_at?.slice(0,10)})`,
    data.profile_md,
    `**Communication style:** ${data.communication_style}`,
    `**Key context:**\n${data.key_context}`,
    data.topics_of_interest?.length ? `**Topics:** ${(data.topics_of_interest as string[]).join(", ")}` : "",
  ].filter(Boolean).join("\n\n");
}

async function execPostToSocial(userId: string, content: string, platform: string, scheduleAt?: string): Promise<string> {
  const fnMap: Record<string, string> = {
    twitter: "mavis-nora-post", linkedin: "mavis-nora-linkedin",
    instagram: "mavis-nora-instagram", discord: "mavis-nora-discord",
  };
  const fn = fnMap[platform];
  if (!fn) return `Unknown platform: ${platform}`;
  const { data, error } = await sb().functions.invoke(fn, {
    body: { user_id: userId, content, schedule_at: scheduleAt },
  });
  if (error) return `Failed: ${String(error)}`;
  return `Posted to ${platform}: ${JSON.stringify(data)}`;
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
        case "complete_quest":
          resultText = await execCompleteQuest(userId, String(args.quest_id ?? ""));
          break;
        case "list_tasks":
          resultText = await execListTasks(userId, args.status ? String(args.status) : undefined, Number(args.limit ?? 20));
          break;
        case "list_goals":
          resultText = await execListGoals(userId, args.status ? String(args.status) : "active");
          break;
        case "log_expense":
          resultText = await execLogExpense(userId, String(args.description ?? ""), Number(args.amount ?? 0), args.currency ? String(args.currency) : "USD", args.category ? String(args.category) : "other", args.expense_date ? String(args.expense_date) : undefined);
          break;
        case "get_revenue_summary":
          resultText = await execGetRevenueSummary(userId);
          break;
        case "list_journal":
          resultText = await execListJournal(userId, Number(args.limit ?? 10));
          break;
        case "create_journal":
          resultText = await execCreateJournal(userId, String(args.content ?? ""), args.mood ? String(args.mood) : undefined, Array.isArray(args.tags) ? args.tags.map(String) : undefined);
          break;
        case "get_user_profile":
          resultText = await execGetUserProfile(userId);
          break;
        case "post_to_social":
          resultText = await execPostToSocial(userId, String(args.content ?? ""), String(args.platform ?? ""), args.schedule_at ? String(args.schedule_at) : undefined);
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
