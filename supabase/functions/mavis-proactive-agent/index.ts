// mavis-proactive-agent
// Morning briefing agent. Gathers data from email, calendar, tasks, and MAVIS memory,
// generates a structured brief with Claude, queues suggested actions, and stores the brief.
//
// verify_jwt = false — supports both cron invocation and manual frontend trigger.
// If no auth header and no userId in body → 401.
//
// POST { action: "run_brief" | "get_last_brief", userId? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshGoogleToken(
  config: Record<string, unknown>,
  adminSb: ReturnType<typeof createClient>,
  userId: string,
  provider: string,
): Promise<string> {
  if (
    config.expires_at &&
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
  if (!data.access_token) {
    throw new Error("Token refresh failed: " + JSON.stringify(data));
  }

  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };

  await adminSb
    .from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", userId)
    .eq("provider", provider);

  return data.access_token as string;
}

// ── Data gathering helpers ────────────────────────────────────────────────────

interface GmailSummary {
  connected: boolean;
  unread_count: number;
  messages: Array<{ from: string; subject: string; snippet: string }>;
  error?: string;
}

async function gatherGmailData(
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<GmailSummary> {
  try {
    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", userId)
      .eq("provider", "gmail")
      .single();

    if (!integration?.config) {
      return { connected: false, unread_count: 0, messages: [], error: "Gmail not connected" };
    }

    const config = integration.config as Record<string, unknown>;
    const accessToken = await refreshGoogleToken(config, adminSb, userId, "gmail");

    const listRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=is:unread%20category:primary",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!listRes.ok) {
      return { connected: true, unread_count: 0, messages: [], error: `Gmail API error: ${listRes.status}` };
    }

    const listData = await listRes.json();
    const messageIds: Array<{ id: string }> = listData.messages ?? [];
    const resultSizeEstimate: number = listData.resultSizeEstimate ?? messageIds.length;

    // Fetch metadata for up to 5 messages
    const messages: Array<{ from: string; subject: string; snippet: string }> = [];
    for (const msg of messageIds.slice(0, 5)) {
      try {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();
        const headers: Array<{ name: string; value: string }> = msgData.payload?.headers ?? [];
        const from = headers.find((h) => h.name === "From")?.value ?? "(unknown)";
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
        messages.push({ from, subject, snippet: (msgData.snippet ?? "").slice(0, 150) });
      } catch { /* skip this message */ }
    }

    return { connected: true, unread_count: resultSizeEstimate, messages };
  } catch (err) {
    return {
      connected: false,
      unread_count: 0,
      messages: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface CalendarSummary {
  connected: boolean;
  events: Array<{ title: string; start: string; end: string; location?: string }>;
  error?: string;
}

async function gatherCalendarData(
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<CalendarSummary> {
  try {
    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", userId)
      .eq("provider", "google_calendar")
      .single();

    if (!integration?.config) {
      return { connected: false, events: [], error: "Google Calendar not connected" };
    }

    const config = integration.config as Record<string, unknown>;
    const accessToken = await refreshGoogleToken(config, adminSb, userId, "google_calendar");

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const timeMin = now.toISOString();
    const timeMax = tomorrow.toISOString();

    const eventsRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&orderBy=startTime&singleEvents=true&maxResults=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!eventsRes.ok) {
      return { connected: true, events: [], error: `Calendar API error: ${eventsRes.status}` };
    }

    const eventsData = await eventsRes.json();
    const items: Array<Record<string, unknown>> = eventsData.items ?? [];

    const events = items.map((item) => ({
      title: (item.summary as string) ?? "(no title)",
      start: ((item.start as Record<string, string>)?.dateTime ?? (item.start as Record<string, string>)?.date ?? "") as string,
      end: ((item.end as Record<string, string>)?.dateTime ?? (item.end as Record<string, string>)?.date ?? "") as string,
      location: (item.location as string) ?? undefined,
    }));

    return { connected: true, events };
  } catch (err) {
    return {
      connected: false,
      events: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface TaskSummary {
  overdue: Array<{ title: string; due_date: string; status: string }>;
  due_today: Array<{ title: string; due_date: string; status: string }>;
}

async function gatherTaskData(
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<TaskSummary> {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const tomorrowIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: tasks } = await adminSb
    .from("tasks")
    .select("title, due_date, status")
    .eq("user_id", userId)
    .lte("due_date", tomorrowIso)
    .not("status", "eq", "completed")
    .order("due_date", { ascending: true })
    .limit(20);

  const allTasks = (tasks ?? []) as Array<{ title: string; due_date: string; status: string }>;
  const overdue = allTasks.filter((t) => t.due_date < todayIso);
  const due_today = allTasks.filter((t) => t.due_date >= todayIso && t.due_date <= tomorrowIso);

  return { overdue, due_today };
}

interface MemorySummary {
  recent: Array<{ role: string; content: string; source: string; created_at: string }>;
}

async function gatherMemoryData(
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<MemorySummary> {
  const { data: memories } = await adminSb
    .from("mavis_persona_memory")
    .select("role, content, source, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  return { recent: (memories ?? []) as Array<{ role: string; content: string; source: string; created_at: string }> };
}

// ── Claude brief generation ───────────────────────────────────────────────────

interface BriefAction {
  type: string;
  description: string;
  priority: number;
}

interface Brief {
  summary: string;
  urgent_items: string[];
  suggested_actions: BriefAction[];
  calendar_preview: string;
}

async function generateBriefWithClaude(
  gmailData: GmailSummary,
  calendarData: CalendarSummary,
  taskData: TaskSummary,
  memoryData: MemorySummary,
): Promise<Brief> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const dataContext = JSON.stringify(
    {
      email: {
        connected: gmailData.connected,
        unread_count: gmailData.unread_count,
        top_messages: gmailData.messages,
        error: gmailData.error,
      },
      calendar: {
        connected: calendarData.connected,
        upcoming_events: calendarData.events,
        error: calendarData.error,
      },
      tasks: {
        overdue: taskData.overdue,
        due_today: taskData.due_today,
      },
      recent_memory: memoryData.recent,
    },
    null,
    2,
  );

  const userMessage = `Here is the operator's current data for the morning briefing:\n\n${dataContext}\n\nGenerate a morning brief. Return ONLY valid JSON matching this schema:\n{\n  "summary": "2-3 sentence overview of the day",\n  "urgent_items": ["item 1", "item 2"],\n  "suggested_actions": [{ "type": "string (e.g. draft_email, schedule_event, create_task)", "description": "what to do", "priority": 1-5 }],\n  "calendar_preview": "1-2 sentence calendar summary"\n}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: "You are MAVIS generating a morning briefing. Be concise and actionable. Always return valid JSON only — no markdown, no explanation.",
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error (${res.status}): ${errText}`);
  }

  const claudeData = await res.json();
  const rawText: string = claudeData.content?.[0]?.text ?? "";

  // Strip markdown code fences if present
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    return JSON.parse(cleaned) as Brief;
  } catch {
    // If JSON parse fails, return a basic structure
    return {
      summary: rawText.slice(0, 300) || "Unable to parse Claude response.",
      urgent_items: [],
      suggested_actions: [],
      calendar_preview: calendarData.events.length > 0
        ? `${calendarData.events.length} event(s) today/tomorrow.`
        : "No upcoming events.",
    };
  }
}

// ── Fallback brief (when Claude fails) ───────────────────────────────────────

function buildFallbackBrief(
  gmailData: GmailSummary,
  calendarData: CalendarSummary,
  taskData: TaskSummary,
): Brief {
  const urgentItems: string[] = [];

  if (gmailData.unread_count > 0) {
    urgentItems.push(`${gmailData.unread_count} unread email(s) in primary inbox`);
  }
  if (taskData.overdue.length > 0) {
    urgentItems.push(`${taskData.overdue.length} overdue task(s): ${taskData.overdue.slice(0, 3).map((t) => t.title).join(", ")}`);
  }
  if (taskData.due_today.length > 0) {
    urgentItems.push(`${taskData.due_today.length} task(s) due today`);
  }

  const calendarPreview = calendarData.connected && calendarData.events.length > 0
    ? `${calendarData.events.length} event(s) coming up. Next: ${calendarData.events[0].title} at ${calendarData.events[0].start}.`
    : calendarData.error ?? "Calendar not available.";

  const summaryParts: string[] = [];
  if (!gmailData.connected) summaryParts.push("Gmail not connected.");
  else summaryParts.push(`${gmailData.unread_count} unread emails.`);
  if (!calendarData.connected) summaryParts.push("Calendar not connected.");
  else summaryParts.push(`${calendarData.events.length} upcoming events.`);
  summaryParts.push(`${taskData.overdue.length} overdue, ${taskData.due_today.length} due today.`);

  return {
    summary: summaryParts.join(" "),
    urgent_items: urgentItems,
    suggested_actions: [],
    calendar_preview: calendarPreview,
  };
}

// ── Queue suggested actions ───────────────────────────────────────────────────

async function queueSuggestedActions(
  actions: BriefAction[],
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<number> {
  if (!actions || actions.length === 0) return 0;

  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const records = actions.map((action) => ({
    user_id: userId,
    action_type: action.type ?? "other",
    source_context: action.description ?? "",
    action_payload: {
      source: "morning_brief",
      suggestion: action.description ?? "",
    },
    autonomy_tier: "approve",
    status: "pending",
    priority: typeof action.priority === "number" ? Math.min(5, Math.max(1, action.priority)) : 3,
    source_system: "mavis-proactive-agent",
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  }));

  const { data, error } = await adminSb
    .from("mavis_action_queue")
    .insert(records)
    .select("id");

  if (error) {
    console.error("[mavis-proactive-agent] Failed to queue actions:", error.message);
    return 0;
  }

  return data?.length ?? 0;
}

// ── Store brief in persona memory ─────────────────────────────────────────────

async function storeBriefInMemory(
  summary: string,
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data, error } = await adminSb
    .from("mavis_persona_memory")
    .insert({
      user_id: userId,
      role: "summary",
      content: summary.slice(0, 2000),
      source: "morning_brief",
      persona_name: "MAVIS",
      importance: 8,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[mavis-proactive-agent] Failed to store brief in memory:", error.message);
    return null;
  }

  return data?.id ?? null;
}

// ── run_brief ─────────────────────────────────────────────────────────────────

async function runBrief(
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Response> {
  // Gather all data sources in parallel — errors in individual sources are non-fatal
  const [gmailData, calendarData, taskData, memoryData] = await Promise.all([
    gatherGmailData(userId, adminSb).catch((err) => ({
      connected: false,
      unread_count: 0,
      messages: [],
      error: String(err),
    } as GmailSummary)),
    gatherCalendarData(userId, adminSb).catch((err) => ({
      connected: false,
      events: [],
      error: String(err),
    } as CalendarSummary)),
    gatherTaskData(userId, adminSb).catch(() => ({
      overdue: [],
      due_today: [],
    } as TaskSummary)),
    gatherMemoryData(userId, adminSb).catch(() => ({
      recent: [],
    } as MemorySummary)),
  ]);

  // Generate brief with Claude; fall back to basic brief on failure
  let brief: Brief;
  let claudeFailed = false;
  try {
    brief = await generateBriefWithClaude(gmailData, calendarData, taskData, memoryData);
  } catch (err) {
    console.error("[mavis-proactive-agent] Claude brief generation failed:", err);
    brief = buildFallbackBrief(gmailData, calendarData, taskData);
    claudeFailed = true;
  }

  // Queue suggested actions (non-fatal)
  let actionsQueued = 0;
  try {
    actionsQueued = await queueSuggestedActions(
      brief.suggested_actions ?? [],
      userId,
      adminSb,
    );
  } catch (err) {
    console.error("[mavis-proactive-agent] Action queuing failed:", err);
  }

  // Store brief in persona memory (non-fatal)
  let briefId: string | null = null;
  try {
    briefId = await storeBriefInMemory(brief.summary, userId, adminSb);
  } catch (err) {
    console.error("[mavis-proactive-agent] Memory storage failed:", err);
  }

  return json({
    ok: true,
    summary: brief.summary,
    urgent_items: brief.urgent_items ?? [],
    calendar_preview: brief.calendar_preview ?? "",
    suggested_actions: brief.suggested_actions ?? [],
    actions_queued: actionsQueued,
    brief_id: briefId,
    data_sources: {
      gmail: { connected: gmailData.connected, error: gmailData.error },
      calendar: { connected: calendarData.connected, error: calendarData.error },
      tasks: { overdue: taskData.overdue.length, due_today: taskData.due_today.length },
      memory_entries: memoryData.recent.length,
    },
    claude_used: !claudeFailed,
  });
}

// ── get_last_brief ────────────────────────────────────────────────────────────

async function getLastBrief(
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<Response> {
  const { data, error } = await adminSb
    .from("mavis_persona_memory")
    .select("id, content, created_at, source")
    .eq("user_id", userId)
    .eq("role", "summary")
    .eq("source", "morning_brief")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return json({ ok: true, brief: null, message: "No morning brief found" });
  }

  return json({ ok: true, brief: data });
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const { action, userId: bodyUserId } = body as {
      action?: string;
      userId?: string;
    };

    // Resolve user ID: from JWT auth header, or from body (for cron/service calls)
    let userId: string | null = null;

    const authHeader = req.headers.get("authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim();
      try {
        const userClient = createClient(SUPABASE_URL, token);
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (user?.id) userId = user.id;
      } catch { /* auth failed — fall through to body userId */ }
    }

    // Allow cron/service callers to pass userId in body
    if (!userId && bodyUserId) {
      userId = bodyUserId;
    }

    // Also support TELEGRAM_OPERATOR_USER_ID as fallback (for cron invocation)
    if (!userId) {
      const operatorId = Deno.env.get("TELEGRAM_OPERATOR_USER_ID");
      if (operatorId) userId = operatorId;
    }

    if (!userId) {
      return json({ ok: false, error: "Unauthorized: no valid auth header or userId" }, 401);
    }

    const requestedAction = (action ?? "run_brief") as string;

    if (requestedAction === "run_brief") {
      return await runBrief(userId, adminSb);
    }

    if (requestedAction === "get_last_brief") {
      return await getLastBrief(userId, adminSb);
    }

    return json(
      { ok: false, error: `Unknown action '${requestedAction}'. Supported: run_brief, get_last_brief` },
      400,
    );
  } catch (err) {
    console.error("[mavis-proactive-agent]", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
