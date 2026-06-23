import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ── CORS headers ──────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Tool definitions (Anthropic tool_use format) ──────────────────────────────
const MAVIS_TOOLS = [
  {
    name: "queue_action",
    description:
      "Queue an action for the operator to review and approve before execution. Use this for ANY write operation — emails, calendar events, social posts, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        action_type: {
          type: "string",
          description:
            "Type: draft_email | schedule_event | create_task | post_social | make_call | other",
        },
        summary: {
          type: "string",
          description:
            "One-sentence human-readable summary shown in the approval queue",
        },
        payload: {
          type: "object",
          description:
            "Full action data. For draft_email: { to, subject, body }. For schedule_event: { title, start, end, description, attendees }. For create_task: { title, description, due_date }",
        },
      },
      required: ["action_type", "summary", "payload"],
    },
  },
  {
    name: "read_emails",
    description: "Read emails from the operator's Gmail inbox",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query (e.g. 'is:unread', 'from:someone@example.com', 'subject:invoice')",
        },
        max_results: {
          type: "number",
          description: "Maximum emails to return (default 10, max 30)",
        },
      },
    },
  },
  {
    name: "read_calendar",
    description: "Read upcoming calendar events",
    input_schema: {
      type: "object" as const,
      properties: {
        days_ahead: {
          type: "number",
          description: "How many days ahead to fetch (default 7)",
        },
        max_results: {
          type: "number",
          description: "Maximum events to return (default 20)",
        },
      },
    },
  },
  {
    name: "search_web",
    description: "Search the web for current information",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        max_results: {
          type: "number",
          description: "Number of results (default 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_pending_actions",
    description: "List actions currently pending in the approval queue",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description:
            "Filter by status: pending | approved | rejected | executed (default: pending)",
        },
      },
    },
  },
  {
    name: "get_user_context",
    description:
      "Get the operator's profile, active quests, tasks, and MAVIS memory",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ── Tool handler ──────────────────────────────────────────────────────────────
interface Env {
  tavilyKey: string;
  supabaseUrl: string;
  serviceKey: string;
}

async function handleTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  supabase: ReturnType<typeof createClient>,
  env: Env,
): Promise<unknown> {
  try {
    switch (name) {
      // ── queue_action ──────────────────────────────────────────────────────
      case "queue_action": {
        const actionType = String(input.action_type ?? "other");
        const summary = String(input.summary ?? "");
        const payload = (input.payload ?? {}) as Record<string, unknown>;

        const { data, error } = await supabase
          .from("mavis_action_queue")
          .insert({
            user_id: userId,
            action_type: actionType,
            action_payload: payload,
            source_context: summary,
            source_system: "mavis-agent",
            autonomy_tier: "approve",
            status: "pending",
            priority: 5,
          })
          .select("id")
          .single();

        if (error) {
          return { queued: false, error: error.message };
        }

        return { queued: true, action_id: data.id, summary };
      }

      // ── read_emails ───────────────────────────────────────────────────────
      case "read_emails": {
        const query = input.query ? String(input.query) : undefined;
        const maxResults = Math.min(Number(input.max_results ?? 10), 30);

        // Check if Gmail is connected
        const { data: integration } = await supabase
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .eq("provider", "gmail")
          .maybeSingle();

        if (!integration?.config) {
          return { error: "Gmail not connected. Connect via /integrations." };
        }

        try {
          const res = await fetch(
            `${env.supabaseUrl}/functions/v1/mavis-gmail-sync`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.serviceKey}`,
                "x-user-id": userId,
              },
              body: JSON.stringify({
                action: "list",
                max: maxResults,
                ...(query ? { query } : {}),
              }),
              signal: AbortSignal.timeout(25_000),
            },
          );

          if (!res.ok) {
            const errText = await res.text();
            return {
              error: `Gmail sync error ${res.status}: ${errText.slice(0, 200)}`,
            };
          }

          return await res.json();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to read emails: ${msg}` };
        }
      }

      // ── read_calendar ─────────────────────────────────────────────────────
      case "read_calendar": {
        const daysAhead = Number(input.days_ahead ?? 7);
        const maxResults = Number(input.max_results ?? 20);

        // Check if Google Calendar is connected (provider = "google" or "google_calendar")
        const { data: integration } = await supabase
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .in("provider", ["google", "google_calendar"])
          .maybeSingle();

        if (!integration?.config) {
          return {
            error:
              "Google Calendar not connected. Connect via /integrations.",
          };
        }

        try {
          const res = await fetch(
            `${env.supabaseUrl}/functions/v1/mavis-calendar-agent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.serviceKey}`,
              },
              body: JSON.stringify({
                action: "list_events",
                days_ahead: daysAhead,
                max: maxResults,
                user_id: userId,
              }),
              signal: AbortSignal.timeout(25_000),
            },
          );

          if (!res.ok) {
            const errText = await res.text();
            return {
              error: `Calendar error ${res.status}: ${errText.slice(0, 200)}`,
            };
          }

          return await res.json();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to read calendar: ${msg}` };
        }
      }

      // ── search_web ────────────────────────────────────────────────────────
      case "search_web": {
        const query = String(input.query ?? "");
        const maxResults = Number(input.max_results ?? 5);

        if (!env.tavilyKey) {
          return { error: "Web search not configured" };
        }

        try {
          const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: env.tavilyKey,
              query,
              max_results: maxResults,
              include_answer: true,
            }),
            signal: AbortSignal.timeout(20_000),
          });

          if (!res.ok) {
            return { error: `Tavily search error ${res.status}` };
          }

          const data = await res.json();
          const results = (data.results ?? []).map(
            (r: { title?: string; url?: string; content?: string }) => ({
              title: r.title ?? "",
              url: r.url ?? "",
              content: (r.content ?? "").slice(0, 600),
            }),
          );

          return { answer: data.answer ?? null, results };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Web search failed: ${msg}` };
        }
      }

      // ── get_pending_actions ───────────────────────────────────────────────
      case "get_pending_actions": {
        const status = String(input.status ?? "pending");

        const { data, error } = await supabase
          .from("mavis_action_queue")
          .select(
            "id, action_type, action_payload, autonomy_tier, status, priority, source_context, source_system, created_at, expires_at",
          )
          .eq("user_id", userId)
          .eq("status", status)
          .order("created_at", { ascending: false })
          .limit(20);

        if (error) {
          return { error: error.message };
        }

        return data ?? [];
      }

      // ── get_user_context ──────────────────────────────────────────────────
      case "get_user_context": {
        const [
          profileResult,
          questsResult,
          tasksResult,
          memoryResult,
        ] = await Promise.allSettled([
          supabase
            .from("profiles")
            .select("id, full_name, email, avatar_url, created_at")
            .eq("id", userId)
            .maybeSingle(),
          supabase
            .from("quests")
            .select("id, title, description, status, progress, due_date")
            .eq("user_id", userId)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("mavis_tasks")
            .select("id, type, description, status, created_at")
            .eq("user_id", userId)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("mavis_persona_memory")
            .select("key, value, category, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

        const profile =
          profileResult.status === "fulfilled"
            ? (profileResult.value.data as {
                full_name?: string;
                email?: string;
              } | null)
            : null;
        const quests =
          questsResult.status === "fulfilled"
            ? (questsResult.value.data ?? [])
            : [];
        const tasks =
          tasksResult.status === "fulfilled"
            ? (tasksResult.value.data ?? [])
            : [];
        const memory =
          memoryResult.status === "fulfilled"
            ? (memoryResult.value.data ?? [])
            : [];

        return {
          profile: profile
            ? {
                name: profile.full_name ?? "Operator",
                email: profile.email ?? null,
              }
            : { name: "Operator", email: null },
          active_quests: quests,
          pending_tasks: tasks,
          recent_memory: memory,
          summary: `Operator has ${quests.length} active quest(s), ${tasks.length} pending task(s), and ${memory.length} recent memory item(s).`,
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Tool execution failed: ${msg}` };
  }
}

// ── Agent loop ────────────────────────────────────────────────────────────────
interface AgentLoopResult {
  content: string;
  toolsUsed: string[];
  actionsQueued: number;
}

async function runAgentLoop(
  messages: Array<{ role: string; content: unknown }>,
  system: string,
  claudeKey: string,
  userId: string,
  supabase: ReturnType<typeof createClient>,
  env: Env,
): Promise<AgentLoopResult> {
  const model = "claude-sonnet-4-6";
  let iteration = 0;
  const MAX_ITERATIONS = 10;
  let actionsQueued = 0;
  const toolsUsed: string[] = [];

  while (iteration < MAX_ITERATIONS) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system,
        messages,
        tools: MAVIS_TOOLS,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Claude API error ${res.status}: ${errText.slice(0, 300)}`,
      );
    }

    const data = await res.json();
    const stopReason: string = data.stop_reason ?? "end_turn";
    const content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }> = data.content ?? [];

    if (stopReason === "end_turn") {
      const text = content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      return { content: text, toolsUsed, actionsQueued };
    }

    if (stopReason === "tool_use") {
      // Append the assistant's message (which contains tool_use blocks)
      messages.push({ role: "assistant", content });

      // Execute all tool calls in parallel
      const toolUseBlocks = content.filter((b) => b.type === "tool_use");

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (toolUse) => {
          const toolName = toolUse.name ?? "";
          const toolInput = (toolUse.input ?? {}) as Record<string, unknown>;

          toolsUsed.push(toolName);

          const result = await handleTool(
            toolName,
            toolInput,
            userId,
            supabase,
            env,
          );

          // Track queued actions
          if (
            toolName === "queue_action" &&
            result !== null &&
            typeof result === "object" &&
            (result as { queued?: boolean }).queued === true
          ) {
            actionsQueued++;
          }

          return {
            type: "tool_result",
            tool_use_id: toolUse.id ?? "",
            content: JSON.stringify(result),
          };
        }),
      );

      // Append tool results as a user message
      messages.push({ role: "user", content: toolResults });
      iteration++;
      continue;
    }

    // Unexpected stop reason — break out
    break;
  }

  return { content: "Agent loop completed.", toolsUsed, actionsQueued };
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT =
  `You are MAVIS — an autonomous AI agent for the operator's life OS.
You have access to real tools. Use them to complete tasks, gather information, and queue actions.

RULES:
- Queue ALL write operations (send_email, schedule_event, create_task) for human approval via queue_action — never execute writes directly
- Use read tools freely to gather information
- After using tools, synthesize findings into a clear response
- If you queued actions, tell the operator exactly what you queued and what the next step is
- Be proactive: if you see something important in emails or calendar, flag it`;

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const rawMessages = Array.isArray(body.messages)
      ? (body.messages as Array<{ role: string; content: unknown }>)
      : [];
    const goal = body.goal ? String(body.goal) : "";
    const mode = body.mode ? String(body.mode) : "AGENT";

    // ── Auth: extract userId ───────────────────────────────────────────────
    let userId = String((body.userId ?? body.user_id) ?? "").trim();

    if (!userId) {
      const authHeader = req.headers.get("authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token) {
        try {
          const userSb = createClient(SUPABASE_URL, token, {
            auth: { persistSession: false },
          });
          const {
            data: { user },
          } = await userSb.auth.getUser();
          userId = user?.id ?? "";
        } catch {
          // fall through — userId remains empty
        }
      }
    }

    if (!userId) {
      return json({ error: "userId required" }, 401);
    }

    // Build initial messages array
    const messages: Array<{ role: string; content: unknown }> =
      rawMessages.length > 0
        ? rawMessages
        : goal
        ? [{ role: "user", content: goal }]
        : [];

    if (messages.length === 0) {
      return json({ error: "goal or messages required" }, 400);
    }

    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    if (!claudeKey) {
      return json({ error: "ANTHROPIC_API_KEY not set" }, 500);
    }

    const env: Env = {
      tavilyKey: Deno.env.get("Tavily_API") ?? "",
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
    };

    const result = await runAgentLoop(
      // Shallow-copy to avoid mutating the parsed body reference
      messages.map((m) => ({ ...m })),
      SYSTEM_PROMPT,
      claudeKey,
      userId,
      supabase,
      env,
    );

    return json({ ok: true, mode, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
