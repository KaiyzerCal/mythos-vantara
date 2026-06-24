// mavis-trigger-engine
// Event-driven agent wakeup. Runs every 10 minutes via pg_cron.
// For each user with Google connected and triggers enabled:
//   1. Checks Gmail for important new emails since last run
//   2. Checks Calendar for events starting in the next 2 hours
//   3. Checks for overdue tasks/quests
//   4. Runs mavis-agent with findings — auto-tier actions execute immediately
//   5. Logs results to mavis_trigger_log

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Token refresh (same pattern as other functions) ───────────────────────────

async function refreshToken(
  config: Record<string, unknown>,
  adminSb: ReturnType<typeof createClient>,
  userId: string,
  provider: string,
): Promise<string> {
  if (typeof config.expires_at === "number" && config.expires_at > Date.now() / 1000 + 300) {
    return config.access_token as string;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     config.client_id as string,
      client_secret: config.client_secret as string,
      refresh_token: config.refresh_token as string,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed");
  const newConfig = { ...config, access_token: data.access_token, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600) };
  await adminSb.from("mavis_user_integrations").update({ config: newConfig }).eq("user_id", userId).eq("provider", provider);
  return data.access_token as string;
}

// ── Gmail: fetch new important emails since a timestamp ───────────────────────

interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isImportant: boolean;
}

async function fetchNewEmails(
  userId: string,
  since: Date,
  adminSb: ReturnType<typeof createClient>,
): Promise<EmailSummary[]> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();

  if (!integration?.config) return [];

  try {
    const token = await refreshToken(integration.config as Record<string, unknown>, adminSb, userId, "gmail");
    const afterEpoch = Math.floor(since.getTime() / 1000);
    const query = `is:unread after:${afterEpoch}`;

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!listRes.ok) return [];

    const listData = await listRes.json();
    const messages: { id: string }[] = listData.messages ?? [];
    if (messages.length === 0) return [];

    // Fetch metadata for each message in parallel (max 8)
    const emails = await Promise.allSettled(
      messages.slice(0, 8).map(async ({ id }) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
        );
        if (!msgRes.ok) return null;
        const msg = await msgRes.json();
        const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
        const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
        const labelIds: string[] = msg.labelIds ?? [];
        return {
          id,
          from:        get("From"),
          subject:     get("Subject"),
          snippet:     (msg.snippet ?? "").slice(0, 200),
          date:        get("Date"),
          isImportant: labelIds.includes("IMPORTANT") || labelIds.includes("STARRED"),
        } satisfies EmailSummary;
      }),
    );

    return emails
      .filter((r): r is PromiseFulfilledResult<EmailSummary | null> => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value as EmailSummary);
  } catch {
    return [];
  }
}

// ── Calendar: fetch events starting in next N hours ───────────────────────────

interface EventSummary {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  attendeeCount: number;
}

async function fetchUpcomingEvents(
  userId: string,
  hoursAhead: number,
  adminSb: ReturnType<typeof createClient>,
): Promise<EventSummary[]> {
  const { data: integration } = await adminSb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (!integration?.config) return [];

  try {
    const token = await refreshToken(integration.config as Record<string, unknown>, adminSb, userId, "google_calendar");
    const now = new Date();
    const until = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${until.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return [];

    const data = await res.json();
    return ((data.items ?? []) as Record<string, unknown>[]).map((e) => ({
      id:            String(e.id ?? ""),
      title:         String(e.summary ?? "Untitled"),
      start:         String((e.start as Record<string, string>)?.dateTime ?? (e.start as Record<string, string>)?.date ?? ""),
      end:           String((e.end as Record<string, string>)?.dateTime ?? (e.end as Record<string, string>)?.date ?? ""),
      location:      e.location ? String(e.location) : undefined,
      attendeeCount: Array.isArray(e.attendees) ? e.attendees.length : 0,
    }));
  } catch {
    return [];
  }
}

// ── Tasks: fetch overdue tasks/quests ─────────────────────────────────────────

interface TaskSummary {
  id: string;
  title: string;
  due: string;
  source: "tasks" | "quests";
}

async function fetchOverdueTasks(
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<TaskSummary[]> {
  const now = new Date().toISOString();
  const results: TaskSummary[] = [];

  const [tasksResult, questsResult] = await Promise.allSettled([
    adminSb
      .from("tasks")
      .select("id, title, due_date")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lt("due_date", now)
      .limit(5),
    adminSb
      .from("quests")
      .select("id, title, deadline")
      .eq("user_id", userId)
      .eq("status", "active")
      .lt("deadline", now)
      .not("deadline", "is", null)
      .limit(5),
  ]);

  if (tasksResult.status === "fulfilled" && tasksResult.value.data) {
    for (const t of tasksResult.value.data as { id: string; title: string; due_date: string }[]) {
      results.push({ id: t.id, title: t.title, due: t.due_date, source: "tasks" });
    }
  }
  if (questsResult.status === "fulfilled" && questsResult.value.data) {
    for (const q of questsResult.value.data as { id: string; title: string; deadline: string }[]) {
      results.push({ id: q.id, title: q.title, due: q.deadline, source: "quests" });
    }
  }

  return results;
}

// ── Build trigger context and run agent ───────────────────────────────────────

async function runTriggerForUser(
  userId: string,
  adminSb: ReturnType<typeof createClient>,
): Promise<{ actionsAuto: number; actionsQueued: number; summary: string }> {
  // Load trigger subscriptions (or use defaults if none exist)
  const { data: subs } = await adminSb
    .from("mavis_trigger_subscriptions")
    .select("trigger_type, enabled, last_checked_at")
    .eq("user_id", userId);

  const subMap = new Map(
    ((subs ?? []) as { trigger_type: string; enabled: boolean; last_checked_at: string | null }[])
      .map((s) => [s.trigger_type, s]),
  );

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const twoHoursAhead = 2;

  // Gather data in parallel
  const emailSub   = subMap.get("new_email");
  const calSub     = subMap.get("calendar_reminder");
  const taskSub    = subMap.get("overdue_task");

  const shouldCheckEmail = emailSub ? emailSub.enabled : true;
  const shouldCheckCal   = calSub   ? calSub.enabled   : true;
  const shouldCheckTasks = taskSub  ? taskSub.enabled   : true;

  const emailSince = emailSub?.last_checked_at ? new Date(emailSub.last_checked_at) : tenMinAgo;
  const [emails, events, overdue] = await Promise.all([
    shouldCheckEmail ? fetchNewEmails(userId, emailSince, adminSb)     : Promise.resolve([]),
    shouldCheckCal   ? fetchUpcomingEvents(userId, twoHoursAhead, adminSb) : Promise.resolve([]),
    shouldCheckTasks ? fetchOverdueTasks(userId, adminSb)               : Promise.resolve([]),
  ]);

  // Nothing actionable — skip agent call
  if (emails.length === 0 && events.length === 0 && overdue.length === 0) {
    // Still update last_checked so we don't re-check the same window
    await upsertLastChecked(userId, adminSb);
    return { actionsAuto: 0, actionsQueued: 0, summary: "Nothing to action" };
  }

  // Build context for the agent
  const parts: string[] = [];

  if (emails.length > 0) {
    parts.push(`NEW EMAILS (${emails.length} unread since last check):\n` +
      emails.map((e) =>
        `  • From: ${e.from}\n    Subject: ${e.subject}\n    Preview: ${e.snippet}${e.isImportant ? " [IMPORTANT]" : ""}`,
      ).join("\n"));
  }

  if (events.length > 0) {
    parts.push(`UPCOMING EVENTS (next ${twoHoursAhead}h):\n` +
      events.map((e) =>
        `  • ${e.title} — starts ${e.start}${e.location ? ` @ ${e.location}` : ""}${e.attendeeCount > 0 ? ` (${e.attendeeCount} attendees)` : ""}`,
      ).join("\n"));
  }

  if (overdue.length > 0) {
    parts.push(`OVERDUE TASKS (${overdue.length}):\n` +
      overdue.map((t) => `  • ${t.title} (was due ${t.due})`).join("\n"));
  }

  const contextSummary = parts.join("\n\n");
  const goal = `You are MAVIS running a background autonomous check for your operator.

Here's what changed since your last check:

${contextSummary}

Your job:
1. For important emails: create a task to follow up if needed (auto-executed), draft replies only if urgent and queue for approval
2. For upcoming events: check if any prep is needed, surface critical ones via a task
3. For overdue tasks: add a memory note about what's overdue so you can mention it next time the operator talks to you
4. DO NOT queue low-value actions. Only surface what genuinely needs attention.
5. Be concise — max 2-3 sentences in your final response.`;

  // Call mavis-agent
  try {
    const agentRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ user_id: userId, goal, mode: "TRIGGER" }),
      signal: AbortSignal.timeout(60_000),
    });

    const agentData = agentRes.ok ? await agentRes.json() : { content: "", actionsQueued: 0, toolsUsed: [] };
    const autoCount = (agentData.toolsUsed ?? []).filter((t: string) => t === "queue_action").length;

    await upsertLastChecked(userId, adminSb);

    return {
      actionsAuto:   autoCount,
      actionsQueued: agentData.actionsQueued ?? 0,
      summary:       agentData.content ?? contextSummary,
    };
  } catch (err) {
    console.error("[trigger-engine] agent call failed:", err);
    await upsertLastChecked(userId, adminSb);
    return { actionsAuto: 0, actionsQueued: 0, summary: contextSummary };
  }
}

async function upsertLastChecked(userId: string, adminSb: ReturnType<typeof createClient>) {
  const now = new Date().toISOString();
  for (const type of ["new_email", "calendar_reminder", "overdue_task"]) {
    await adminSb.from("mavis_trigger_subscriptions").upsert(
      { user_id: userId, trigger_type: type, last_checked_at: now },
      { onConflict: "user_id,trigger_type" },
    );
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Heartbeat: mark running
    adminSb.from("mavis_function_health").upsert({
      function_name: "mavis-trigger-engine",
      last_started_at: new Date().toISOString(),
      last_status: "running",
      run_count: 1,
      expected_interval_min: 10,
      updated_at: new Date().toISOString(),
    }, { onConflict: "function_name" }).catch(() => {});

    const body = await req.json().catch(() => ({})) as Record<string, string>;
    const action = body.action ?? "run";

    // ── run: full sweep for all users with Google connected ───────────────
    if (action === "run") {
      if (!ANTHROPIC_KEY) return json({ ok: false, error: "ANTHROPIC_API_KEY not set" }, 500);

      // Find all users who have Gmail connected with a refresh token
      const { data: integrations } = await adminSb
        .from("mavis_user_integrations")
        .select("user_id, config")
        .eq("provider", "gmail")
        .eq("status", "active");

      const users = ((integrations ?? []) as { user_id: string; config: Record<string, unknown> }[])
        .filter((r) => r.config?.refresh_token);

      if (users.length === 0) return json({ ok: true, processed: 0, message: "No users with Google connected" });

      const results = await Promise.allSettled(
        users.map(async ({ user_id }) => {
          try {
            const result = await runTriggerForUser(user_id, adminSb);

            // Log to mavis_trigger_log
            await adminSb.from("mavis_trigger_log").insert({
              user_id,
              trigger_types:  ["new_email", "calendar_reminder", "overdue_task"],
              context_summary: result.summary.slice(0, 1000),
              agent_response:  result.summary.slice(0, 2000),
              actions_auto:    result.actionsAuto,
              actions_queued:  result.actionsQueued,
            });

            return { user_id, ...result };
          } catch (err) {
            console.error(`[trigger-engine] user ${user_id} failed:`, err);
            return { user_id, error: String(err) };
          }
        }),
      );

      const processed = results.filter((r) => r.status === "fulfilled").length;

      adminSb.from("mavis_function_health").upsert({
        function_name: "mavis-trigger-engine",
        last_completed_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
        run_count: 1,
        expected_interval_min: 10,
        updated_at: new Date().toISOString(),
      }, { onConflict: "function_name" }).catch(() => {});

      return json({ ok: true, processed, results: results.map((r) => r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason }) });
    }

    // ── check_user: run for a specific user (for testing) ─────────────────
    if (action === "check_user") {
      const userId = body.user_id ?? "";
      if (!userId) return json({ ok: false, error: "user_id required" }, 400);

      const result = await runTriggerForUser(userId, adminSb);
      return json({ ok: true, ...result });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const _errMsg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-trigger-engine]", _errMsg);
    const _errSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    _errSb.from("mavis_function_health").upsert({
      function_name: "mavis-trigger-engine",
      last_completed_at: new Date().toISOString(),
      last_status: "error",
      last_error: _errMsg.slice(0, 500),
      run_count: 1,
      error_count: 1,
      expected_interval_min: 10,
      updated_at: new Date().toISOString(),
    }, { onConflict: "function_name" }).catch(() => {});
    return json({ ok: false, error: _errMsg }, 500);
  }
});
