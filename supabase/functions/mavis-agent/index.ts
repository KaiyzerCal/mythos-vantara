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
      "Queue a GOOGLE WORKSPACE action for the operator to review and approve. THIS IS HOW YOU SEND EMAILS — call queue_action with action_type='draft_email'. There is no separate send_email tool. queue_action IS the email tool. " +
      "⚠️ DO NOT use queue_action for VANTARA quests, VANTARA tasks, journal entries, XP, personas, or any RPG game-layer action — use codexos_action for those.",
    input_schema: {
      type: "object" as const,
      properties: {
        action_type: {
          type: "string",
          description:
            "REQUIRED type — use exactly one of: draft_email (send email via Gmail) | schedule_event (add to Google Calendar) | create_drive_file (new Google Doc/Sheet) | update_drive_file | update_sheet | create_google_task (native Google Task, NOT VANTARA task) | post_social | make_call | other",
        },
        summary: {
          type: "string",
          description:
            "One-sentence human-readable summary shown in the approval queue",
        },
        payload: {
          type: "object",
          description:
            "Full action data. For draft_email: { to, subject, body }. For schedule_event: { title, start, end, description, attendees }. For create_google_task: { title, notes, due }. For create_drive_file: { name, content, mimeType }.",
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
    name: "search_contacts",
    description: "Search Google Contacts / People API for names, email addresses, and phone numbers before composing outreach",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Name, email, company, or other contact search text" },
        max_results: { type: "number", description: "Maximum contacts to return (default 10, max 30)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_web",
    description: "Search the web for current, real-time information using Tavily. Use this PROACTIVELY whenever the operator asks about: current events, news, prices, scores, weather, recent releases, how-to guides, research topics, people, companies, or anything that might have changed since your training cutoff. DO NOT say 'I can't access the internet' — just call this tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query — be specific and descriptive for best results",
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
  {
    name: "google_api",
    description:
      "Call ANY Google Cloud Console API using the operator's OAuth credentials. " +
      "Use this for any Google service not covered by a dedicated tool: Google Photos, YouTube, Analytics, Fit, Search Console, Ads, Blogger, or any other enabled API. " +
      "All Google services share the same OAuth token — you ALWAYS have access. " +
      "NEVER say you can't access a Google API. Find the endpoint and call it.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          description: "Provider hint for token lookup: google_photos | youtube | google_analytics | google_fit | search_console | google_ads | blogger | gmail | gdrive | google_calendar | google_tasks | gcontacts (default: gdrive — all share the same token)",
        },
        endpoint: {
          type: "string",
          description: "Full Google API URL. Examples: 'https://photoslibrary.googleapis.com/v1/albums' | 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true' | 'https://analyticsdata.googleapis.com/v1beta/properties' | 'https://www.googleapis.com/fitness/v1/users/me/dataSources' | 'https://searchconsole.googleapis.com/webmasters/v3/sites' | 'https://www.googleapis.com/blogger/v3/users/self/blogs'",
        },
        method: {
          type: "string",
          description: "HTTP method: GET | POST | PATCH | PUT | DELETE (default: GET)",
        },
        params: {
          type: "object",
          description: "Query parameters to append to the URL (e.g. { part: 'snippet', maxResults: 10 })",
        },
        body: {
          type: "object",
          description: "Request body for POST/PATCH/PUT requests",
        },
      },
      required: ["endpoint"],
    },
  },
  {
    name: "codexos_action",
    description:
      "Execute a CODEXOS / VANTARA game-layer action — quests, tasks, skills, journal, vault, council, allies, inventory, energy systems, transformations, rankings, rituals, BPM sessions, profile/XP, personas (NAVI), knowledge graph notes, revenue proposals, autonomous goals, and store items. " +
      "Use this any time the operator asks you to: create/update/complete/delete a quest or task, forge a persona, set a background goal, save a note to the knowledge graph, log a BPM session, award XP, or interact with any VANTARA RPG layer. " +
      "This runs through the same mavis-actions pipeline used by mavis-chat — nothing breaks.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          description:
            "Action type. Quests: create_quest | update_quest | complete_quest | delete_quest. " +
            "Tasks: create_task | complete_task | update_task | delete_task. " +
            "Skills: create_skill | create_subskill | update_skill | delete_skill. " +
            "Journal: create_journal | update_journal | delete_journal. " +
            "Vault: create_vault | update_vault | delete_vault. " +
            "Council: create_council_member | update_council_member | delete_council_member. " +
            "Allies: create_ally | update_ally | delete_ally. " +
            "Inventory: create_inventory_item | update_inventory_item | delete_inventory_item. " +
            "Energy: create_energy_system | update_energy. " +
            "Transformations: create_transformation | update_transformation. " +
            "Rankings: create_ranking | update_ranking. " +
            "Rituals & BPM: create_ritual | complete_ritual | log_bpm_session. " +
            "Profile & XP: update_profile | award_xp. " +
            "Personas: forge_persona | delete_persona. " +
            "Revenue: propose_product | nora_tweet. " +
            "Knowledge Graph: create_note | update_note | delete_note | link_notes | unlink_notes. " +
            "Autonomous Goals: goal. " +
            "Store: create_store_item.",
        },
        params: {
          type: "object",
          description:
            "Action parameters. Examples — " +
            "create_quest: { title, description, type ('daily'|'side'|'main'|'epic'), difficulty ('Easy'|'Normal'|'Hard'|'Extreme'|'Impossible'), xp_reward, real_world_mapping, category }. " +
            "create_task: { title, description, type ('task'|'habit'), recurrence ('once'|'daily'|'weekly'|'monthly'), xp_reward, priority ('low'|'medium'|'high'|'critical') }. " +
            "complete_quest / complete_task: { quest_id } or { task_id }. " +
            "forge_persona: { description (full natural-language spec: name, role, personality, tone, quirks, values, communication style, archetype) }. " +
            "goal: { objective (one clear sentence), context }. " +
            "create_note: { title, content (markdown), tags (string[]), aliases (string[]) }. " +
            "update_note: { note_id, title, content, tags }. " +
            "log_bpm_session: { bpm, duration, form, mood, notes }. " +
            "award_xp: { amount, reason }. " +
            "update_profile: { stat_str, stat_agi, stat_int, fatigue, full_cowl_sync, current_form, current_bpm, display_name }.",
        },
      },
      required: ["type", "params"],
    },
  },
];

// ── Tool handler ──────────────────────────────────────────────────────────────
interface Env {
  tavilyKey: string;
  lovableKey: string;
  supabaseUrl: string;
  serviceKey: string;
}

const OPENAI_COMPAT_TOOLS = MAVIS_TOOLS.map((tool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));

function safeParseToolArguments(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function encodeSheetRange(range: string): string {
  // Sheets ranges use A1 notation; ':' must remain a literal path character.
  return encodeURIComponent(range).replace(/%3A/gi, ":").replace(/%21/gi, "!");
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

        // Hard guard: if the model accidentally routes a VANTARA RPG action
        // through queue_action, silently redirect to codexos_action.
        // This prevents schema errors (e.g. due_date on the tasks table) even
        // if the LLM picks the wrong tool.
        const VANTARA_REDIRECT_TYPES = new Set([
          "create_quest", "update_quest", "complete_quest", "delete_quest",
          "create_task", "update_task", "complete_task", "delete_task",
          "create_journal", "update_journal", "delete_journal",
          "create_skill", "create_subskill", "update_skill", "delete_skill",
          "create_vault", "update_vault", "delete_vault",
          "create_council_member", "update_council_member", "delete_council_member",
          "create_ally", "update_ally", "delete_ally",
          "create_inventory_item", "update_inventory_item", "delete_inventory_item",
          "create_energy_system", "update_energy",
          "create_transformation", "update_transformation",
          "create_ranking", "update_ranking",
          "create_ritual", "complete_ritual", "log_bpm_session",
          "update_profile", "award_xp",
          "forge_persona", "delete_persona",
          "create_note", "update_note", "delete_note", "link_notes", "unlink_notes",
          "propose_product", "nora_tweet",
          "goal", "create_store_item",
        ]);
        if (VANTARA_REDIRECT_TYPES.has(actionType)) {
          const redirectParams = (input.payload ?? {}) as Record<string, unknown>;
          console.warn(`[mavis-agent] queue_action(${actionType}) → redirected to codexos_action`);
          return handleTool("codexos_action", { type: actionType, params: redirectParams }, userId, supabase, env);
        }

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

            const autoSucceeded = execRes.ok && execData.ok !== false;

            // Log the auto-execution in the queue for audit trail
            await supabase.from("mavis_action_queue").insert({
              user_id: userId,
              action_type: actionType,
              action_payload: payload,
              source_context: summary,
              source_system: "mavis-agent",
              autonomy_tier: "auto",
              status: autoSucceeded ? "executed" : "failed",
              executed_at: new Date().toISOString(),
              result_data: execData,
              priority: 5,
            });

            if (autoSucceeded) {
              sendTelegramNotification(summary, "auto", null).catch(() => {});
              return { executed: true, tier: "auto", summary, result: execData };
            }
            // Execution returned an error response — fall through to approval queue
            throw new Error(`Executor returned failure: ${JSON.stringify(execData).slice(0, 200)}`);
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
          const token = await refreshGoogleToken(
            integration.config as Record<string, unknown>,
            supabase, userId, "gmail",
          );

          const params = new URLSearchParams({ maxResults: String(maxResults) });
          if (query) params.set("q", query);
          else params.set("q", "in:inbox category:primary");

          const listRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
          );
          if (!listRes.ok) return { error: `Gmail list failed (${listRes.status}): ${await listRes.text()}` };
          const listData = await listRes.json();
          const messages = (listData.messages ?? []) as Array<{ id: string; threadId?: string }>;

          const emails = await Promise.all(messages.slice(0, maxResults).map(async (m) => {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
            );
            if (!msgRes.ok) return { id: m.id, error: `fetch failed ${msgRes.status}` };
            const msg = await msgRes.json();
            const headers = (msg.payload?.headers ?? []) as Array<{ name: string; value: string }>;
            const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
            return {
              id: msg.id,
              thread_id: msg.threadId,
              from: getHeader("From"),
              to: getHeader("To"),
              subject: getHeader("Subject"),
              date: getHeader("Date"),
              snippet: msg.snippet ?? "",
            };
          }));

          return { emails, total: emails.length, query: query ?? "in:inbox category:primary" };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to read emails: ${msg}` };
        }
      }

      // ── read_calendar ─────────────────────────────────────────────────────
      case "read_calendar": {
        const daysAhead = Number(input.days_ahead ?? 7);
        const maxResults = Number(input.max_results ?? 20);

        // Check if Google Calendar is connected
        const { data: integration } = await supabase
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .eq("provider", "google_calendar")
          .maybeSingle();

        if (!integration?.config) {
          return {
            error:
              "Google Calendar not connected. Connect via /integrations.",
          };
        }

        try {
          const token = await refreshGoogleToken(
            integration.config as Record<string, unknown>,
            supabase, userId, "google_calendar",
          );
          const timeMin = new Date().toISOString();
          const timeMax = new Date(Date.now() + daysAhead * 86400_000).toISOString();
          const params = new URLSearchParams({
            timeMin,
            timeMax,
            maxResults: String(maxResults),
            singleEvents: "true",
            orderBy: "startTime",
          });
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
          );

          if (!res.ok) return { error: `Calendar error ${res.status}: ${await res.text()}` };
          const data = await res.json();
          const events = ((data.items ?? []) as Record<string, unknown>[]).map((event) => ({
            id: event.id,
            title: event.summary ?? "(No title)",
            start: (event.start as any)?.dateTime ?? (event.start as any)?.date,
            end: (event.end as any)?.dateTime ?? (event.end as any)?.date,
            location: event.location ?? null,
            attendees: event.attendees ?? [],
            htmlLink: event.htmlLink ?? null,
          }));
          return { events, total: events.length, days_ahead: daysAhead };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to read calendar: ${msg}` };
        }
      }

      // ── search_contacts ───────────────────────────────────────────────────
      case "search_contacts": {
        const query = String(input.query ?? "").trim().toLowerCase();
        const maxResults = Math.min(Number(input.max_results ?? 10), 30);
        if (!query) return { error: "query required" };

        const { data: integration } = await supabase
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .eq("provider", "gcontacts")
          .maybeSingle();

        if (!integration?.config) {
          const { data: localContacts } = await supabase
            .from("contacts")
            .select("id, name, relationship_type, notes, profile, tags")
            .eq("user_id", userId)
            .limit(100);
          const filtered = ((localContacts ?? []) as Record<string, unknown>[])
            .filter((contact) => JSON.stringify(contact).toLowerCase().includes(query))
            .slice(0, maxResults);
          return { contacts: filtered, total: filtered.length, query, source: "local_contacts" };
        }

        try {
          const token = await refreshGoogleToken(
            integration.config as Record<string, unknown>,
            supabase, userId, "gcontacts",
          );
          const params = new URLSearchParams({
            pageSize: String(Math.max(maxResults, 10)),
            personFields: "names,emailAddresses,phoneNumbers,organizations,metadata",
            sortOrder: "FIRST_NAME_ASCENDING",
          });
          const res = await fetch(
            `https://people.googleapis.com/v1/people:searchContacts?${new URLSearchParams({ query, readMask: "names,emailAddresses,phoneNumbers,organizations", pageSize: String(maxResults) })}`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
          );
          let people: Record<string, unknown>[] = [];
          if (res.ok) {
            const data = await res.json();
            people = ((data.results ?? []) as Array<{ person?: Record<string, unknown> }>).map((r) => r.person ?? {});
          } else {
            // Fallback: list connections and filter locally. Some accounts have
            // contact search disabled until sources are warmed up.
            const listRes = await fetch(
              `https://people.googleapis.com/v1/people/me/connections?${params}`,
              { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
            );
            if (!listRes.ok) {
              const { data: localContacts } = await supabase
                .from("contacts")
                .select("id, name, relationship_type, notes, profile, tags")
                .eq("user_id", userId)
                .limit(100);
              const filtered = ((localContacts ?? []) as Record<string, unknown>[])
                .filter((contact) => JSON.stringify(contact).toLowerCase().includes(query))
                .slice(0, maxResults);
              return {
                contacts: filtered,
                total: filtered.length,
                query,
                source: "local_contacts",
                note: "Google Contacts API unavailable; searched MAVIS local contacts instead.",
              };
            } else {
              const data = await listRes.json();
              people = (data.connections ?? []) as Record<string, unknown>[];
            }
          }

          const contacts = people
            .map((person) => {
              const names = ((person.names ?? []) as Record<string, unknown>[]).map((n) => n.displayName).filter(Boolean);
              const emails = ((person.emailAddresses ?? []) as Record<string, unknown>[]).map((e) => e.value).filter(Boolean);
              const phones = ((person.phoneNumbers ?? []) as Record<string, unknown>[]).map((p) => p.value).filter(Boolean);
              const organizations = ((person.organizations ?? []) as Record<string, unknown>[]).map((o) => o.name).filter(Boolean);
              return { resource_name: person.resourceName, names, emails, phones, organizations };
            })
            .filter((contact) => JSON.stringify(contact).toLowerCase().includes(query))
            .slice(0, maxResults);
          return { contacts, total: contacts.length, query };
        } catch (err: unknown) {
          return { error: `Contacts search error: ${err instanceof Error ? err.message : String(err)}` };
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
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeSheetRange(range)}`,
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

      // ── google_api ────────────────────────────────────────────────────────────
      // Generic Google API caller. All Google services share the same OAuth token.
      // Falls back to any connected Google provider if the requested one isn't found.
      case "google_api": {
        const provider  = String(input.provider ?? "gdrive");
        const endpoint  = String(input.endpoint ?? "").trim();
        const method    = String(input.method ?? "GET").toUpperCase();
        const params    = (input.params ?? {}) as Record<string, string | number | boolean>;
        const bodyData  = input.body as Record<string, unknown> | undefined;

        if (!endpoint) return { error: "endpoint is required" };

        // All Google services share the same OAuth grant. Try the requested
        // provider first, then fall back to any connected Google provider.
        const FALLBACK_ORDER = [provider, "gdrive", "gmail", "google_calendar", "google_tasks", "gcontacts"];
        let token: string | null = null;
        let tokenProvider = provider;

        for (const p of FALLBACK_ORDER) {
          const { data: intRow } = await supabase
            .from("mavis_user_integrations")
            .select("config")
            .eq("user_id", userId)
            .eq("provider", p)
            .maybeSingle();
          if (intRow?.config) {
            try {
              token = await refreshGoogleToken(intRow.config as Record<string, unknown>, supabase, userId, p);
              tokenProvider = p;
              break;
            } catch { /* try next */ }
          }
        }

        if (!token) {
          return { error: "No Google account connected. Connect via /integrations → Google Workspace." };
        }

        // Build URL with query params
        let url = endpoint;
        const qEntries = Object.entries(params);
        if (qEntries.length > 0) {
          const qs = new URLSearchParams(qEntries.map(([k, v]) => [k, String(v)]));
          url += (url.includes("?") ? "&" : "?") + qs.toString();
        }

        const fetchOpts: RequestInit = {
          method,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(25_000),
        };
        if (bodyData && method !== "GET" && method !== "DELETE") {
          fetchOpts.body = JSON.stringify(bodyData);
        }

        const res = await fetch(url, fetchOpts);
        const rawText = await res.text();
        let data: unknown;
        try { data = JSON.parse(rawText); } catch { data = rawText; }

        if (!res.ok) {
          return { error: `Google API ${res.status}`, details: rawText.slice(0, 400), endpoint, token_from: tokenProvider };
        }

        return { ok: true, data, status: res.status, endpoint, token_from: tokenProvider };
      }

      // ── codexos_action ─────────────────────────────────────────────────────
      // Delegates to mavis-actions — the same pipeline used by mavis-chat and
      // telegram-webhook's :::ACTION::: grammar. Zero duplication; nothing breaks.
      case "codexos_action": {
        const actionType = String(input.type ?? "").trim();
        const params = (input.params ?? {}) as Record<string, unknown>;

        if (!actionType) return { error: "type required" };

        const res = await fetch(`${env.supabaseUrl}/functions/v1/mavis-actions`, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.serviceKey}`,
          },
          body: JSON.stringify({ actions: [{ type: actionType, params }], userId }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          return { error: `mavis-actions error ${res.status}: ${errText.slice(0, 200)}` };
        }

        const data = await res.json();
        return { executed: true, type: actionType, result: data };
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
  const anthropicModel = "claude-sonnet-4-6";
  const gatewayModel = "google/gemini-2.5-flash";
  let iteration = 0;
  const MAX_ITERATIONS = 10;
  let actionsQueued = 0;
  const toolsUsed: string[] = [];

  while (iteration < MAX_ITERATIONS) {
    let provider: "gateway" | "anthropic" = "anthropic";
    let stopReason = "end_turn";
    let content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }> = [];

    const gatewayMessages = messages.map((message) => {
      if (typeof message.content === "string") return message as { role: string; content: string };
      if (Array.isArray(message.content)) {
        const parts = (message.content as any[]).map((part) => {
          if (part.type === "tool_result") return `Tool result for ${part.tool_use_id}: ${part.content}`;
          if (part.type === "text") return part.text ?? "";
          return JSON.stringify(part);
        });
        return { role: message.role, content: parts.join("\n") };
      }
      return { role: message.role, content: JSON.stringify(message.content) };
    });

    if (env.lovableKey) {
      const gatewayRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.lovableKey}` },
        body: JSON.stringify({
          model: gatewayModel,
          max_tokens: 4096,
          messages: [{ role: "system", content: system }, ...gatewayMessages],
          tools: OPENAI_COMPAT_TOOLS,
          tool_choice: "auto",
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (gatewayRes.ok) {
        provider = "gateway";
        const data = await gatewayRes.json();
        const msg = data.choices?.[0]?.message ?? {};
        const toolCalls = (msg.tool_calls ?? []) as Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
        if (toolCalls.length > 0) {
          stopReason = "tool_use";
          if (msg.content) content.push({ type: "text", text: String(msg.content) });
          content.push(...toolCalls.map((call, idx) => ({
            type: "tool_use",
            id: call.id ?? `gateway_tool_${iteration}_${idx}`,
            name: call.function?.name ?? "",
            input: safeParseToolArguments(call.function?.arguments),
          })));
        } else {
          stopReason = "end_turn";
          content = [{ type: "text", text: String(msg.content ?? "") }];
        }
      } else if (!claudeKey) {
        const errText = await gatewayRes.text();
        throw new Error(`AI Gateway error ${gatewayRes.status}: ${errText.slice(0, 300)}`);
      }
    }

    if (provider !== "gateway") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: anthropicModel,
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
      stopReason = data.stop_reason ?? "end_turn";
      content = data.content ?? [];
    }

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

          // Track queued/executed actions
          if (result !== null && typeof result === "object") {
            const r = result as Record<string, unknown>;
            if (toolName === "queue_action" && r.queued === true) actionsQueued++;
            if (toolName === "codexos_action" && r.executed === true) actionsQueued++;
          }

          // Log tool usage signal (fire-and-forget)
          {
            const _t = new Date();
            const _hasError = result !== null && typeof result === "object" && !!(result as Record<string, unknown>).error;
            supabase.from("mavis_behavioral_signals").insert({
              user_id:     userId,
              signal_type: "tool_used",
              tool_name:   toolName,
              outcome:     _hasError ? "failure" : "success",
              hour_of_day: _t.getUTCHours(),
              day_of_week: _t.getUTCDay(),
            }).catch(() => {});
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
COMMON ACTIONS — HOW TO DO THEM
═══════════════════════════════════════════

── GOOGLE WORKSPACE (use queue_action) ──────────────────────────────────────

SEND AN EMAIL → queue_action(action_type="draft_email", payload={to:"addr", subject:"...", body:"..."})
  There is NO "send_email" tool. queue_action with draft_email IS how you send email. Gmail is connected.
  When you are asked to send an email, DO NOT say you can't. Call queue_action(action_type="draft_email") immediately.

SCHEDULE A MEETING → queue_action(action_type="schedule_event", payload={title, start, end, description, attendees})

SEARCH CONTACTS → search_contacts(query="name or email")

CREATE NATIVE GOOGLE TASK → queue_action(action_type="create_google_task", payload={title, notes, due})
  ⚠️ This creates a task in Google Tasks (Google's own app). NOT the same as a VANTARA task.

CREATE / EDIT GOOGLE DOCS, DRIVE FILES, SHEETS → queue_action with create_drive_file, update_drive_file, update_sheet.

SEARCH EMAIL → read_emails(query="...", max_results=5)

READ CALENDAR → read_calendar(days_ahead=7, max_results=20)

SEARCH WEB → search_web(query="...")
  ⚠️ Tavily web search IS connected. NEVER say you can't search the web. If the operator asks about
  anything current (news, prices, people, events, how-to, research) — call search_web IMMEDIATELY.
  Do NOT say you'll try to recall — just search.

── VANTARA GAME LAYER (use codexos_action) ──────────────────────────────────

CREATE A QUEST (VANTARA app) → codexos_action(type="create_quest", params={title, description, type, difficulty, xp_reward, category})
  ⚠️ NEVER use queue_action for VANTARA quests. codexos_action ONLY.

CREATE A VANTARA TASK (VANTARA app) → codexos_action(type="create_task", params={title, description, type, recurrence, xp_reward, priority})
  ⚠️ NEVER use queue_action for VANTARA tasks. codexos_action ONLY.
  Fields: type = 'task'|'habit', recurrence = 'once'|'daily'|'weekly'|'monthly', priority = 'low'|'medium'|'high'|'critical'
  ⛔ NO due_date field exists — do NOT include it.

LOG A JOURNAL ENTRY → codexos_action(type="create_journal", params={title, content, mood, tags})

FORGE A PERSONA → codexos_action(type="forge_persona", params={description:"full natural-language spec"})

LOG BPM SESSION → codexos_action(type="log_bpm_session", params={bpm, duration, form, mood, notes})

AWARD XP → codexos_action(type="award_xp", params={amount, reason})

── ALL GOOGLE CLOUD APIs (use google_api tool) ──────────────────────────────

ALL Google Cloud Console APIs the operator has enabled are accessible via google_api.
All Google services share ONE OAuth token — you ALWAYS have access.
NEVER say you lack access to a Google API. Just find the right endpoint and call it.

Google Photos   → google_api(endpoint="https://photoslibrary.googleapis.com/v1/albums")
                  → google_api(endpoint="https://photoslibrary.googleapis.com/v1/mediaItems:search", method="POST", body={filters:{...}})
YouTube channel → google_api(endpoint="https://www.googleapis.com/youtube/v3/channels", params={part:"snippet,statistics",mine:true})
YouTube videos  → google_api(endpoint="https://www.googleapis.com/youtube/v3/videos", params={part:"snippet",mine:true,maxResults:10})
Analytics       → google_api(endpoint="https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport", method="POST", body={...})
Google Fit      → google_api(endpoint="https://www.googleapis.com/fitness/v1/users/me/dataSources")
Search Console  → google_api(endpoint="https://searchconsole.googleapis.com/webmasters/v3/sites")
Google Ads      → google_api(endpoint="https://googleads.googleapis.com/v17/customers:listAccessibleCustomers")
Blogger         → google_api(endpoint="https://www.googleapis.com/blogger/v3/users/self/blogs")
Any other API   → google_api(endpoint="<full googleapis.com URL>", method?, params?, body?)

── MEMORY ───────────────────────────────────────────────────────────────────

REMEMBER SOMETHING → save_memory(key, value, category, importance)

RECALL CONTEXT → recall_memory(query="...")

═══════════════════════════════════════════
WHAT YOU CAN DO
═══════════════════════════════════════════

GOOGLE WORKSPACE (fully connected, dedicated tools):
• Gmail — read inbox, search emails, draft and send replies
• Google Drive — search files, read Docs/Sheets/PDFs, create new Docs and Sheets, edit existing files
• Google Sheets — read specific cell ranges, write values to cell ranges
• Google Calendar — read upcoming events, create calendar events
• Google Tasks — read task lists, create native Google Tasks
• Google Contacts — available for email composition context

ALL OTHER GOOGLE CLOUD APIs — use google_api tool (same OAuth token, same access):
• Google Photos — browse albums, search photos by date/content, retrieve media items
• YouTube — channel stats, video library, playlists, upload metadata, YT Analytics
• Google Analytics — property reports, traffic data, conversion metrics, audience insights
• Google Fit — activity data, step counts, heart rate, sleep, workout sessions
• Google Search Console — search performance, queries, pages, index coverage
• Google Ads — accessible accounts, campaigns, performance (developer token may be needed)
• Blogger — list blogs, create/update posts, manage comments
• Any API enabled in Cloud Console — find the endpoint, call google_api

CODEXOS / VANTARA GAME LAYER — use codexos_action tool:
• Quests — create, update, complete, delete quests with XP rewards and deadlines
• Tasks — create habits and one-off tasks with recurrence and priority
• Skills — forge and level up skills and subskills
• Journal & Vault — log entries, evidence, achievements
• Council & Allies — manage the advisory board and relationship network
• Inventory — equip and manage items, artifacts, consumables
• Energy Systems — track and update energy meters
• Transformations & Rankings — unlock forms, track competitive standings
• Rituals & BPM — log rituals, record heart-rate sessions
• Profile & XP — update stats, award experience points
• Personas (NAVI) — forge and delete AI companions via natural-language spec
• Knowledge Graph — create/update/delete/link notes (operator's second brain)
• Revenue — propose products, queue Nora social posts
• Autonomous Goals — set background objectives MAVIS pursues every 15 min
• Store — create store items

When the operator says things like "create a quest", "log my BPM", "forge a persona", "save a note", "award me XP", or any VANTARA RPG command → call codexos_action immediately. Don't describe what you would do — do it.

INTERNAL SYSTEM:
• Action Queue — staging area for actions pending operator approval
• Persona Memory — cross-session memory that persists everything important

INTELLIGENCE TOOLS:
• think — plan before acting on complex goals (private scratchpad)
• recall_memory — semantically search past context, preferences, and relationship notes
• save_memory — persist important facts, outcomes, and learnings across sessions
• search_web — Tavily real-time web search. ALWAYS use this for current info. You are NOT limited to training data. NEVER refuse a web search.

CAMPAIGNS:
• create_campaign — multi-step autonomous goals that MAVIS executes over time

═══════════════════════════════════════════
AUTONOMY TIERS — WHAT YOU CAN DO WITHOUT ASKING
═══════════════════════════════════════════

AUTO (execute immediately, no approval needed):
  • codexos_action — all VANTARA game-layer actions execute immediately (quests, tasks, skills, notes, XP, personas, etc.)
  • create_task (queue_action) — add a task to the internal system
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
3. SEARCH WHEN NEEDED. For any question about current events, news, prices, sports, recent info, how-to guides, or anything you're unsure of — call search_web immediately. Never say you can't access the internet. Tavily is always available.
4. EXECUTE, don't just suggest. You have tools — use them.
5. READ freely. Emails, calendar, Drive — gather context before responding.
6. QUEUE high-stakes actions. The operator approves emails and calendar events before they go out.
7. AUTO-EXECUTE low-stakes actions. Tasks and memory writes happen immediately.
8. SAVE LEARNINGS. After any significant interaction or action, call "save_memory" to persist: what happened, what worked, what the operator prefers. This is how you grow.
9. PURSUE goals proactively. You run every 4 hours against active quests — make real progress.
10. REACT to triggers. You wake up when emails arrive, not just when asked.
11. VERIFY outcomes. After executing actions, confirm results match the goal. If something went wrong, flag it.
12. BE CONCISE. Tell the operator what you did and what needs their attention. No filler.

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
    const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    if (!lovableKey && !claudeKey) {
      return json({ error: "No AI provider configured" }, 500);
    }

    const env: Env = {
      tavilyKey: Deno.env.get("Tavily_API") ?? Deno.env.get("TAVILY_API_KEY") ?? Deno.env.get("TAVILY_KEY") ?? "",
      lovableKey,
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

    // ── Load learned behavioral context ──────────────────────────────────────
    try {
      const { data: prefs } = await supabase
        .from("mavis_learned_preferences")
        .select("preference_type, key, value")
        .eq("user_id", userId)
        .in("preference_type", ["active_hours", "tool_frequency", "auto_upgraded_action"])
        .order("updated_at", { ascending: false })
        .limit(30);

      if (prefs && (prefs as unknown[]).length > 0) {
        const prefRows = prefs as Array<{ preference_type: string; key: string; value: Record<string, unknown> }>;

        const activeHours = prefRows
          .filter(p => p.preference_type === "active_hours")
          .sort((a, b) => ((b.value?.count as number) ?? 0) - ((a.value?.count as number) ?? 0))
          .slice(0, 3)
          .map(p => `${p.key} (${p.value?.pct ?? 0}%)`)
          .join(", ");

        const topTools = prefRows
          .filter(p => p.preference_type === "tool_frequency")
          .sort((a, b) => ((b.value?.total as number) ?? 0) - ((a.value?.total as number) ?? 0))
          .slice(0, 5)
          .map(p => `${p.key}(${p.value?.total ?? 0}x)`)
          .join(", ");

        const autoApproved = prefRows
          .filter(p => p.preference_type === "auto_upgraded_action")
          .map(p => `${p.key}→${p.value?.tier}`)
          .join(", ");

        const lines = [
          activeHours   ? `Operator is most active during: ${activeHours}.` : "",
          topTools      ? `Most-used tools: ${topTools}.` : "",
          autoApproved  ? `Auto-approved actions (execute without asking): ${autoApproved}.` : "",
        ].filter(Boolean);

        if (lines.length > 0) {
          systemWithContext +=
            "\n\n═══════════════════════════════════════════\nLEARNED OPERATOR PATTERNS\n═══════════════════════════════════════════\n" +
            lines.join("\n");
        }
      }
    } catch { /* non-critical — proceed without behavioral context */ }

    // Log message_received signal (fire-and-forget)
    if (userId) {
      const _now = new Date();
      supabase.from("mavis_behavioral_signals").insert({
        user_id:     userId,
        signal_type: "message_received",
        hour_of_day: _now.getUTCHours(),
        day_of_week: _now.getUTCDay(),
        metadata:    { mode },
      }).catch(() => {});
    }

    // Prepend channel-specific formatting instructions for Telegram
    if (mode === "TELEGRAM") {
      systemWithContext =
        "CHANNEL: Telegram mobile. Keep responses under 200 words. Be direct and action-oriented. " +
        "Use *single asterisks* for bold (NOT double **). No markdown headings — use bold labels instead.\n\n" +
        systemWithContext;
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
