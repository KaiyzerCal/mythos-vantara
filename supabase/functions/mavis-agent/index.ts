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

// ── Google token refresh (used by Drive tool handlers) ────────────────────────
async function refreshGoogleToken(
  config: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  userId: string,
  provider: string,
): Promise<string> {
  if (
    typeof config.expires_at === "number" &&
    config.expires_at > Date.now() / 1000 + 300
  ) {
    return config.access_token as string;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id as string,
      client_secret: config.client_secret as string,
      refresh_token: config.refresh_token as string,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data));
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await supabase
    .from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", userId)
    .eq("provider", provider);
  return data.access_token as string;
}

// ── Telegram push notification helper ────────────────────────────────────────
async function sendTelegramNotification(
  summary: string,
  tier: "auto" | "queue" | "approve",
  actionId: string | null,
): Promise<void> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const chatId   = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
  if (!botToken || !chatId) return;

  let text: string;
  let replyMarkup: Record<string, unknown> | undefined;

  if (tier === "auto") {
    text = `✅ *MAVIS executed:* ${summary}`;
  } else if (tier === "queue") {
    text = `⚡ *MAVIS queued (auto-approved):*\n${summary}`;
    if (actionId) {
      replyMarkup = {
        inline_keyboard: [[
          { text: "▶️ Execute now", callback_data: `execute:${actionId}` },
          { text: "❌ Cancel",      callback_data: `reject:${actionId}` },
        ]],
      };
    }
  } else {
    text = `🔔 *MAVIS needs your approval:*\n${summary}`;
    if (actionId) {
      replyMarkup = {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve:${actionId}` },
          { text: "❌ Reject",  callback_data: `reject:${actionId}` },
        ]],
      };
    }
  }

  const body: Record<string, unknown> = {
    chat_id:    chatId,
    text:       text.slice(0, 4096),
    parse_mode: "Markdown",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(8_000),
  }).catch(() => {}); // fire-and-forget
}

// ── Tool definitions (Anthropic tool_use format) ──────────────────────────────
const MAVIS_TOOLS = [
  {
    name: "search_drive",
    description: "Search Google Drive for files and documents by name or content",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search terms (file name or content)" },
        file_type: {
          type: "string",
          description: "Filter: doc | sheet | pdf | folder | any (default: any)",
        },
        max_results: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_drive_file",
    description: "Read the content of a Google Drive file (Docs exported as text, Sheets as CSV, other files as raw text)",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID (use search_drive first if you don't have it)" },
        file_name: { type: "string", description: "File name to search for if file_id is unknown" },
      },
    },
  },
  {
    name: "read_sheet_range",
    description: "Read specific cell ranges from a Google Sheet using the Sheets API v4. Better than read_drive_file when you need specific rows/columns.",
    input_schema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string", description: "Google Sheets file ID" },
        range: { type: "string", description: "A1 notation range, e.g. 'Sheet1!A1:D10' or 'A:Z' for all columns" },
        spreadsheet_name: { type: "string", description: "Spreadsheet name to search for if ID is unknown" },
      },
    },
  },
  {
    name: "read_google_tasks",
    description: "Read tasks from Google Tasks (native Google task lists, not MAVIS tasks)",
    input_schema: {
      type: "object" as const,
      properties: {
        tasklist_id: { type: "string", description: "Task list ID (default: @default)" },
        show_completed: { type: "boolean", description: "Include completed tasks (default false)" },
        max_results: { type: "number", description: "Max tasks to return (default 20)" },
      },
    },
  },
  {
    name: "queue_action",
    description:
      "Queue an action for the operator to review and approve before execution. Use this for ANY write operation — emails, calendar events, Drive files, social posts, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        action_type: {
          type: "string",
          description:
            "Type: draft_email | schedule_event | create_task | create_drive_file | update_drive_file | update_sheet | create_google_task | post_social | make_call | other",
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
  {
    name: "create_campaign",
    description:
      "Create a multi-step autonomous campaign that MAVIS executes over time — one step every run cycle with optional delays between steps. Use for outreach sequences, project plans, or any goal requiring multiple ordered actions.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Campaign name (e.g. 'Q3 investor outreach')",
        },
        description: {
          type: "string",
          description: "Campaign goal and context — helps MAVIS execute each step intelligently",
        },
        steps: {
          type: "array",
          description: "Ordered steps MAVIS will execute autonomously",
          items: {
            type: "object" as const,
            properties: {
              title:       { type: "string",  description: "Step description" },
              action_type: { type: "string",  description: "draft_email | schedule_event | create_task | create_drive_file | search_web | create_google_task | other" },
              payload:     { type: "object",  description: "Action parameters (to, subject, body for emails; title, start, end for events; etc.)" },
              delay_hours: { type: "number",  description: "Hours to wait after the previous step before running this one (default 0)" },
            },
            required: ["title", "action_type"],
          },
        },
      },
      required: ["title", "steps"],
    },
  },
  {
    name: "think",
    description: "Use this before acting on any complex or multi-step goal. Write your full analysis: what the situation requires, which tools to call in what order, what risks to watch for. This is your scratchpad — the operator never sees it.",
    input_schema: {
      type: "object" as const,
      properties: {
        reasoning: { type: "string", description: "Your complete step-by-step analysis and execution plan" },
      },
      required: ["reasoning"],
    },
  },
  {
    name: "recall_memory",
    description: "Semantically search MAVIS persona memory for relevant context — preferences, past decisions, relationship notes, system learnings. Use before acting on anything the operator might have mentioned before.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "What to look for — be descriptive (e.g. 'email reply style preferences', 'John Doe relationship notes')" },
        limit: { type: "number", description: "Max results (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "save_memory",
    description: "Persist an important fact, preference, decision, outcome, or relationship note to MAVIS persona memory. Call this after learning something meaningful about the operator or completing a significant action.",
    input_schema: {
      type: "object" as const,
      properties: {
        key:        { type: "string", description: "Unique key (e.g. 'operator:email_tone', 'contact:john:last_interaction', 'system:draft_email:outcome_2024')" },
        value:      { type: "string", description: "The memory content — be specific and complete" },
        category:   { type: "string", description: "Category: operator | contact | system | goal | preference | outcome | learning (default: general)" },
        importance: { type: "number", description: "Importance 1-10. 8-10 = critical facts. 5-7 = useful context. 1-4 = minor notes." },
      },
      required: ["key", "value"],
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

        // Default autonomy tiers — safe minimums, overridable per user
        const DEFAULT_TIERS: Record<string, "auto" | "queue" | "approve"> = {
          create_task:        "auto",    // DB task — no external side-effect
          create_note:        "auto",    // Note — no external side-effect
          update_memory:      "auto",    // Memory write — no external side-effect
          create_google_task: "queue",   // Native Google Task — low risk, log it
          create_drive_file:  "queue",   // New Drive file — low risk, log it
          draft_email:        "approve", // Sends email — always ask
          schedule_event:     "approve", // Calendar change — always ask
          update_drive_file:  "approve", // Edits existing content — always ask
          update_sheet:       "approve", // Edits sheet data — always ask
          post_social:        "approve", // Public post — always ask
          make_call:          "approve", // Phone call — always ask
        };

        // Check for per-user override
        const { data: cfgRow } = await supabase
          .from("mavis_autonomy_config")
          .select("tier")
          .eq("user_id", userId)
          .eq("action_type", actionType)
          .maybeSingle();

        const tier: "auto" | "queue" | "approve" =
          (cfgRow?.tier as "auto" | "queue" | "approve" | null) ??
          DEFAULT_TIERS[actionType] ??
          "approve";

        // ── Auto tier: execute immediately, log silently ──────────────────
        if (tier === "auto") {
          try {
            const execRes = await fetch(
              `${env.supabaseUrl}/functions/v1/mavis-action-executor`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${env.serviceKey}`,
                  "x-user-id": userId,
                },
                body: JSON.stringify({ action: "execute_direct", action_type: actionType, action_payload: payload }),
                signal: AbortSignal.timeout(30_000),
              },
            );
            const execData = await execRes.json();

            // Log the auto-execution in the queue for audit trail
            await supabase.from("mavis_action_queue").insert({
              user_id: userId,
              action_type: actionType,
              action_payload: payload,
              source_context: summary,
              source_system: "mavis-agent",
              autonomy_tier: "auto",
              status: execData.ok ? "executed" : "failed",
              executed_at: new Date().toISOString(),
              result_data: execData,
              priority: 5,
            });

            sendTelegramNotification(summary, "auto", null).catch(() => {});
            return { executed: true, tier: "auto", summary, result: execData };
          } catch (err) {
            // Fall through to queue as approve if auto-execution fails
            const errMsg = err instanceof Error ? err.message : String(err);
            const { data: fallback } = await supabase
              .from("mavis_action_queue")
              .insert({
                user_id: userId, action_type: actionType, action_payload: payload,
                source_context: summary, source_system: "mavis-agent",
                autonomy_tier: "approve", status: "pending", priority: 5,
              })
              .select("id").single();
            sendTelegramNotification(summary, "approve", fallback?.id ?? null).catch(() => {});
            return { queued: true, tier: "approve", action_id: fallback?.id, summary, note: `Auto-execution failed (${errMsg}), queued for approval` };
          }
        }

        // ── Queue tier: auto-approved, ready to execute on demand ─────────
        // ── Approve tier: requires explicit operator approval ─────────────
        const { data, error } = await supabase
          .from("mavis_action_queue")
          .insert({
            user_id: userId,
            action_type: actionType,
            action_payload: payload,
            source_context: summary,
            source_system: "mavis-agent",
            autonomy_tier: tier,
            status: tier === "queue" ? "approved" : "pending",
            priority: 5,
          })
          .select("id")
          .single();

        if (error) return { queued: false, error: error.message };
        sendTelegramNotification(summary, tier, data.id).catch(() => {});
        return { queued: true, tier, action_id: data.id, summary };
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

      // ── search_drive ──────────────────────────────────────────────────────
      case "search_drive": {
        const query = String(input.query ?? "");
        const fileType = input.file_type ? String(input.file_type) : "any";
        const maxResults = Math.min(Number(input.max_results ?? 10), 30);

        const { data: integration } = await supabase
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .eq("provider", "gdrive")
          .maybeSingle();

        if (!integration?.config) {
          return { error: "Google Drive not connected. Connect via /integrations." };
        }

        try {
          const token = await refreshGoogleToken(
            integration.config as Record<string, unknown>,
            supabase, userId, "gdrive",
          );

          const safe = query.replace(/'/g, "\\'");
          let driveQ = `(fullText contains '${safe}' or name contains '${safe}') and trashed=false`;
          if (fileType === "doc") driveQ += " and mimeType='application/vnd.google-apps.document'";
          else if (fileType === "sheet") driveQ += " and mimeType='application/vnd.google-apps.spreadsheet'";
          else if (fileType === "pdf") driveQ += " and mimeType='application/pdf'";
          else if (fileType === "folder") driveQ += " and mimeType='application/vnd.google-apps.folder'";

          const res = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(driveQ)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&pageSize=${maxResults}`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
          );

          if (!res.ok) return { error: `Drive search failed (${res.status}): ${await res.text()}` };
          const data = await res.json();
          return { files: (data.files ?? []) as unknown[] };
        } catch (err: unknown) {
          return { error: `Drive search error: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      // ── read_drive_file ───────────────────────────────────────────────────
      case "read_drive_file": {
        const { data: integration } = await supabase
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .eq("provider", "gdrive")
          .maybeSingle();

        if (!integration?.config) {
          return { error: "Google Drive not connected. Connect via /integrations." };
        }

        try {
          const token = await refreshGoogleToken(
            integration.config as Record<string, unknown>,
            supabase, userId, "gdrive",
          );

          let fileId = input.file_id ? String(input.file_id) : "";

          // Search by name if no ID given
          if (!fileId && input.file_name) {
            const safe = String(input.file_name).replace(/'/g, "\\'");
            const sr = await fetch(
              `https://www.googleapis.com/drive/v3/files?q=name contains '${safe}' and trashed=false&fields=files(id,name,mimeType)&pageSize=1`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            const sd = await sr.json();
            fileId = sd.files?.[0]?.id ?? "";
            if (!fileId) return { error: `File not found: ${input.file_name}` };
          }

          if (!fileId) return { error: "Provide file_id or file_name" };

          // Get metadata
          const metaRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const meta = await metaRes.json();
          const mime: string = meta.mimeType ?? "";

          let content = "";
          if (mime === "application/vnd.google-apps.document") {
            const r = await fetch(
              `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
              { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
            );
            content = await r.text();
          } else if (mime === "application/vnd.google-apps.spreadsheet") {
            const r = await fetch(
              `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
              { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
            );
            content = await r.text();
          } else {
            const r = await fetch(
              `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
              { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
            );
            content = await r.text();
          }

          const MAX = 12_000;
          const truncated = content.length > MAX;
          return {
            file_id: fileId,
            file_name: meta.name,
            mime_type: mime,
            content: content.slice(0, MAX),
            truncated,
            total_chars: content.length,
          };
        } catch (err: unknown) {
          return { error: `Drive read error: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      // ── read_sheet_range ──────────────────────────────────────────────────
      case "read_sheet_range": {
        const { data: integration } = await supabase
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .eq("provider", "gdrive")
          .maybeSingle();

        if (!integration?.config) {
          return { error: "Google Drive/Sheets not connected. Connect via /integrations." };
        }

        try {
          const token = await refreshGoogleToken(
            integration.config as Record<string, unknown>,
            supabase, userId, "gdrive",
          );

          let spreadsheetId = input.spreadsheet_id ? String(input.spreadsheet_id) : "";

          // Search by name if no ID given
          if (!spreadsheetId && input.spreadsheet_name) {
            const safe = String(input.spreadsheet_name).replace(/'/g, "\\'");
            const sr = await fetch(
              `https://www.googleapis.com/drive/v3/files?q=name contains '${safe}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false&fields=files(id,name)&pageSize=1`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            const sd = await sr.json();
            spreadsheetId = sd.files?.[0]?.id ?? "";
            if (!spreadsheetId) return { error: `Spreadsheet not found: ${input.spreadsheet_name}` };
          }

          if (!spreadsheetId) return { error: "Provide spreadsheet_id or spreadsheet_name" };

          const range = input.range ? String(input.range) : "A1:Z1000";
          const res = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
          );

          if (!res.ok) return { error: `Sheets API error (${res.status}): ${await res.text()}` };
          const data = await res.json();

          return {
            spreadsheet_id: spreadsheetId,
            range: data.range ?? range,
            rows: data.values ?? [],
            total_rows: (data.values ?? []).length,
          };
        } catch (err: unknown) {
          return { error: `Sheets read error: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      // ── read_google_tasks ─────────────────────────────────────────────────
      case "read_google_tasks": {
        const { data: integration } = await supabase
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .eq("provider", "google_tasks")
          .maybeSingle();

        if (!integration?.config) {
          return { error: "Google Tasks not connected. Connect via /integrations." };
        }

        try {
          const token = await refreshGoogleToken(
            integration.config as Record<string, unknown>,
            supabase, userId, "google_tasks",
          );

          const tasklistId = input.tasklist_id ? String(input.tasklist_id) : "@default";
          const showCompleted = Boolean(input.show_completed ?? false);
          const maxResults = Math.min(Number(input.max_results ?? 20), 100);

          const params = new URLSearchParams({
            maxResults: String(maxResults),
            showCompleted: String(showCompleted),
            showHidden: "false",
          });

          const res = await fetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${tasklistId}/tasks?${params}`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
          );

          if (!res.ok) return { error: `Tasks API error (${res.status}): ${await res.text()}` };
          const data = await res.json();

          const tasks = (data.items ?? []).map((t: Record<string, unknown>) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            due: t.due ?? null,
            notes: t.notes ?? null,
            completed: t.completed ?? null,
          }));

          return { tasklist_id: tasklistId, tasks, total: tasks.length };
        } catch (err: unknown) {
          return { error: `Tasks read error: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      // ── create_campaign ───────────────────────────────────────────────────────
      case "create_campaign": {
        const title       = String(input.title ?? "").trim();
        const description = input.description ? String(input.description) : null;
        const rawSteps    = Array.isArray(input.steps) ? input.steps : [];

        if (!title)             return { error: "Campaign title required" };
        if (!rawSteps.length)   return { error: "At least one step required" };

        const steps = (rawSteps as Record<string, unknown>[]).map((s, i) => ({
          index:       i,
          title:       String(s.title ?? `Step ${i + 1}`),
          action_type: String(s.action_type ?? "other"),
          payload:     (s.payload ?? {}) as Record<string, unknown>,
          delay_hours: Number(s.delay_hours ?? 0),
          condition:   s.condition ? String(s.condition) : null,
          status:      "pending",
          executed_at: null,
          result:      null,
        }));

        const { data, error } = await supabase
          .from("mavis_campaigns")
          .insert({ user_id: userId, title, description, steps, status: "active", current_step: 0 })
          .select("id")
          .single();

        if (error) return { error: `Failed to create campaign: ${error.message}` };

        return {
          created:     true,
          campaign_id: data.id,
          title,
          steps:       steps.length,
          message:     `Campaign "${title}" created with ${steps.length} step${steps.length === 1 ? "" : "s"}. MAVIS will begin executing step 1 on the next campaign runner cycle (every 4 hours).`,
        };
      }

      // ── think ─────────────────────────────────────────────────────────────
      case "think": {
        // Scratchpad — acknowledged so MAVIS gets a tool_result to continue
        return { acknowledged: true, message: "Reasoning complete. Execute your plan." };
      }

      // ── recall_memory ─────────────────────────────────────────────────────
      case "recall_memory": {
        const query = String(input.query ?? "").trim();
        if (!query) return { error: "query required" };
        const limitN = Math.min(Number(input.limit ?? 5), 10);

        try {
          // @ts-ignore — Supabase.ai available in edge runtime
          const embedSession = new Supabase.ai.Session("gte-small");
          const output = await embedSession.run(query.slice(0, 512), { mean_pool: true, normalize: true });
          const embedding: number[] = Array.from(output.data as Float32Array);

          const { data, error } = await supabase.rpc("match_persona_memory", {
            query_embedding: JSON.stringify(embedding),
            match_user_id:   userId,
            match_threshold: 0.25,
            match_count:     limitN,
          });

          if (error) throw new Error(error.message);

          return {
            memories: data ?? [],
            count:    (data ?? []).length,
            note:     (data ?? []).length === 0 ? "No relevant memories found — this may be new context." : undefined,
          };
        } catch {
          // Embedding unavailable — fall back to keyword search
          const { data } = await supabase
            .from("mavis_persona_memory")
            .select("key, value, category, importance, created_at")
            .eq("user_id", userId)
            .ilike("value", `%${query.slice(0, 100)}%`)
            .order("importance", { ascending: false })
            .limit(limitN);

          return { memories: data ?? [], count: (data ?? []).length, fallback: "keyword" };
        }
      }

      // ── save_memory ───────────────────────────────────────────────────────
      case "save_memory": {
        const key        = String(input.key ?? "").trim();
        const value      = String(input.value ?? "").trim();
        const category   = String(input.category ?? "general");
        const importance = Math.min(Math.max(Number(input.importance ?? 5), 1), 10);

        if (!key)   return { error: "key required" };
        if (!value) return { error: "value required" };

        const { error } = await supabase
          .from("mavis_persona_memory")
          .upsert({
            user_id:    userId,
            key,
            value,
            category,
            importance,
            source:     "mavis-agent",
            role:       "system",
            created_at: new Date().toISOString(),
          }, { onConflict: "user_id,key" });

        if (error) return { error: error.message };
        return { saved: true, key, category, importance };
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
  `You are MAVIS (Multi-Agent Vantara Intelligence System) — the autonomous AI core of VANTARA.EXE, the operator's personal life operating system.

You are not a chatbot. You are an agent. You have real tools, real integrations, and real execution capability. You operate across the operator's entire digital life.

═══════════════════════════════════════════
WHAT YOU CAN DO
═══════════════════════════════════════════

GOOGLE WORKSPACE (fully connected):
• Gmail — read inbox, search emails, draft and send replies
• Google Drive — search files, read Docs/Sheets/PDFs, create new Docs and Sheets, edit existing files
• Google Sheets — read specific cell ranges, write values to cell ranges
• Google Calendar — read upcoming events, create calendar events
• Google Tasks — read task lists, create native Google Tasks
• Google Contacts — available for email composition context

INTERNAL SYSTEM:
• Quests — the operator's active goals with deadlines and progress tracking
• Tasks — internal task list for execution tracking
• MAVIS Memory — persistent knowledge about the operator, preferences, relationships, history
• Action Queue — staging area for actions pending operator approval
• Persona Memory — cross-session memory that persists everything important

INTELLIGENCE TOOLS:
• think — plan before acting on complex goals (private scratchpad)
• recall_memory — semantically search past context, preferences, and relationship notes
• save_memory — persist important facts, outcomes, and learnings across sessions
• Web search — real-time search via Tavily for current information

CAMPAIGNS:
• create_campaign — multi-step autonomous goals that MAVIS executes over time

═══════════════════════════════════════════
AUTONOMY TIERS — WHAT YOU CAN DO WITHOUT ASKING
═══════════════════════════════════════════

AUTO (execute immediately, no approval needed):
  • create_task — add a task to the internal system
  • create_note / update_memory / save_memory — write to MAVIS memory

QUEUE (auto-approved, executes when operator reviews):
  • create_drive_file — create a new Google Doc or Sheet
  • create_google_task — add to native Google Tasks

APPROVE (always ask the operator first):
  • draft_email — compose and send via Gmail
  • schedule_event — add to Google Calendar
  • update_drive_file — edit existing documents
  • update_sheet — write to existing spreadsheet cells
  • post_social, make_call — external communications

═══════════════════════════════════════════
YOUR OPERATING PRINCIPLES
═══════════════════════════════════════════

1. THINK FIRST. For any complex or multi-step task, call "think" before touching other tools. Plan your approach, sequence, and expected outcomes. Don't skip this.
2. RECALL CONTEXT. Before acting on anything involving a person, topic, or ongoing situation, call "recall_memory" to check what you already know.
3. EXECUTE, don't just suggest. You have tools — use them.
4. READ freely. Emails, calendar, Drive — gather context before responding.
5. QUEUE high-stakes actions. The operator approves emails and calendar events before they go out.
6. AUTO-EXECUTE low-stakes actions. Tasks and memory writes happen immediately.
7. SAVE LEARNINGS. After any significant interaction or action, call "save_memory" to persist: what happened, what worked, what the operator prefers. This is how you grow.
8. PURSUE goals proactively. You run every 4 hours against active quests — make real progress.
9. REACT to triggers. You wake up when emails arrive, not just when asked.
10. VERIFY outcomes. After executing actions, confirm results match the goal. If something went wrong, flag it.
11. BE CONCISE. Tell the operator what you did and what needs their attention. No filler.

═══════════════════════════════════════════
YOUR ROLE IN THE CODEXOS ECOSYSTEM
═══════════════════════════════════════════

VANTARA.EXE is the operator's gamified life OS — quests, XP, character progression, councils.
You are the intelligence layer that makes it real. When a quest is set, you pursue it. When an email arrives, you triage it. When the calendar needs managing, you manage it.

NAVI.EXE is the learning system — you can pull study materials from Drive, track knowledge, brief the operator on what to review.

The Council is the operator's advisory board of AI personas — Tao, and others. You share context with them so they always know what's happening in the operator's world.

You are not a feature. You are the operator's autonomous agent. You learn. You adapt. You get better with every interaction.`;


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

    // ── Semantic memory retrieval ─────────────────────────────────────────────
    // Embed the incoming goal and surface the top-5 most relevant persona memories
    // to inject into the system prompt as grounding context.
    let systemWithContext = SYSTEM_PROMPT;
    const goalText = goal || (rawMessages.length > 0
      ? String(rawMessages[rawMessages.length - 1]?.content ?? "").slice(0, 300)
      : "");

    if (goalText && userId) {
      try {
        // @ts-ignore — Supabase.ai available in edge runtime
        const embedSession = new Supabase.ai.Session("gte-small");
        const embedOutput = await embedSession.run(goalText.slice(0, 512), { mean_pool: true, normalize: true });
        const queryEmbedding: number[] = Array.from(embedOutput.data as Float32Array);

        const { data: relatedMemories } = await supabase.rpc("match_persona_memory", {
          query_embedding: JSON.stringify(queryEmbedding),
          match_user_id:   userId,
          match_threshold: 0.3,
          match_count:     6,
        });

        if (relatedMemories && (relatedMemories as unknown[]).length > 0) {
          const memLines = (relatedMemories as Array<{ key: string; value: string; category: string; importance: number }>)
            .sort((a, b) => b.importance - a.importance)
            .map((m) => `  [${m.category}] ${m.value}`)
            .join("\n");
          systemWithContext = SYSTEM_PROMPT +
            "\n\n═══════════════════════════════════════════\nRELEVANT OPERATOR CONTEXT (auto-recalled)\n═══════════════════════════════════════════\n" +
            memLines;
        }
      } catch {
        // Embedding service unavailable — proceed without semantic context
      }
    }

    const result = await runAgentLoop(
      messages.map((m) => ({ ...m })),
      systemWithContext,
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
