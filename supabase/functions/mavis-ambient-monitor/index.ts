// mavis-ambient-monitor
// Always-on ambient brain — runs every 5 minutes via pg_cron.
// No user JWT required; uses service role to scan all recently-active users
// and proactively insert tasks, insights, and ambient event records.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRIORITY_KEYWORDS = ["invoice", "contract", "deadline", "urgent", "asap", "legal"];

// ── Helpers ────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86400 * 1000).toISOString();
}

/** Fire-and-forget call to another edge function. */
async function callEdgeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${SB_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SB_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // non-fatal — best-effort push
  }
}

// ── Per-user checks ────────────────────────────────────────────────────────

interface CheckResult {
  issues: number;
  actions: number;
  details: Record<string, unknown>;
}

/** Check 1: overdue active quests */
async function checkOverdueQuests(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  const { data: quests, error } = await sb
    .from("quests")
    .select("id, title")
    .eq("user_id", userId)
    .eq("status", "active")
    .lt("deadline", nowIso())
    .not("deadline", "is", null);

  if (error || !quests || quests.length === 0) return result;

  const count = quests.length;
  const titles = quests.map((q: any) => q.title).join(", ");
  const ids = quests.map((q: any) => q.id);

  await sb.from("mavis_tasks").insert({
    user_id: userId,
    type: "goal",
    description: `Review and rescue ${count} overdue quest(s): ${titles}`,
    payload: {
      objective: `Rescue ${count} overdue quest(s)`,
      quests: ids,
    },
    status: "pending",
  });

  result.issues = count;
  result.actions = 1;
  result.details = { overdue_quests: count, titles };
  return result;
}

/** Check 2: health anomaly detection */
async function checkHealthAnomalies(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  // Query the metric-type/value style table (20260518040000 schema)
  const { data: metrics, error } = await sb
    .from("health_metrics")
    .select("metric_type, value, metric_date, created_at")
    .eq("user_id", userId)
    .gte("created_at", daysAgo(2))
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !metrics || metrics.length === 0) return result;

  const anomalies: string[] = [];

  for (const m of metrics as any[]) {
    const v = Number(m.value);
    const t = String(m.metric_type ?? "").toLowerCase();
    if (t === "hrv" && v < 30) anomalies.push(`HRV ${v} (< 30)`);
    if ((t === "resting_hr" || t === "resting_heart_rate") && v > 90)
      anomalies.push(`Resting HR ${v} (> 90)`);
    if ((t === "sleep_score" || t === "readiness") && v < 60)
      anomalies.push(`${m.metric_type} ${v} (< 60)`);
  }

  // Deduplicate
  const unique = [...new Set(anomalies)];
  if (unique.length === 0) return result;

  const details = unique.join("; ");

  await sb.from("mavis_insights").insert({
    user_id: userId,
    title: "Health Alert",
    content: `Anomaly detected: ${details}`,
    category: "health",
    severity: "warning",
    generated_at: nowIso(),
  });

  await sb.from("mavis_tasks").insert({
    user_id: userId,
    type: "health",
    description: `Health anomaly detected: ${details}. Consider adjusting training intensity or recovery plan.`,
    payload: { anomalies: unique },
    status: "pending",
  });

  result.issues = unique.length;
  result.actions = 2;
  result.details = { health_anomalies: unique };
  return result;
}

/** Check 3: unread priority emails in the last 24 h */
async function checkPriorityEmails(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  let emails: any[] | null = null;

  try {
    const { data, error } = await sb
      .from("gmail_messages")
      .select("id, subject, from_email, received_at")
      .eq("user_id", userId)
      .eq("is_read", false)
      .gte("received_at", hoursAgo(24))
      .order("received_at", { ascending: false })
      .limit(5);

    if (!error && data) emails = data;
  } catch {
    // table may not exist yet — skip gracefully
    return result;
  }

  if (!emails || emails.length === 0) return result;

  const priority = emails.filter((e: any) => {
    const subj = String(e.subject ?? "").toLowerCase();
    return PRIORITY_KEYWORDS.some((kw) => subj.includes(kw));
  });

  if (priority.length === 0) return result;

  const subjects = priority.map((e: any) => `• ${e.subject} (from: ${e.from_email})`).join("\n");

  await sb.from("mavis_insights").insert({
    user_id: userId,
    title: "Priority Emails Detected",
    content: `${priority.length} unread priority email(s) in the last 24 h:\n${subjects}`,
    category: "communication",
    severity: "warning",
    generated_at: nowIso(),
  });

  result.issues = priority.length;
  result.actions = 1;
  result.details = { priority_emails: priority.length, subjects: priority.map((e: any) => e.subject) };
  return result;
}

/** Check 4: revenue discussion gap — nudge if no talk in 7 days */
async function checkRevenueMentions(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  const { data, error } = await sb
    .from("mavis_memory")
    .select("created_at")
    .eq("user_id", userId)
    .eq("role", "assistant")
    .ilike("content", "%revenue%")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) return result;

  const rows = data ?? [];
  if (rows.length > 0) {
    const latest = new Date(rows[0].created_at).getTime();
    const sevenDaysMs = 7 * 86400 * 1000;
    if (Date.now() - latest < sevenDaysMs) return result; // discussed recently
  }

  // No revenue discussion in 7+ days
  await sb.from("mavis_tasks").insert({
    user_id: userId,
    type: "business",
    description:
      "No revenue or business metrics discussed in the last 7 days. Consider reviewing your income streams, pipeline, or financial goals.",
    payload: { trigger: "revenue_silence_7d" },
    status: "pending",
  });

  result.issues = 1;
  result.actions = 1;
  result.details = { revenue_gap: true, last_discussed: rows[0]?.created_at ?? null };
  return result;
}

/** Check 5: upcoming calendar events in the next 2 hours */
async function checkUpcomingEvents(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  const windowEnd = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  let events: any[] | null = null;

  try {
    const { data, error } = await sb
      .from("calendar_events")
      .select("id, title, start_time, location")
      .eq("user_id", userId)
      .gte("start_time", nowIso())
      .lte("start_time", windowEnd)
      .order("start_time", { ascending: true });

    if (!error && data) events = data;
  } catch {
    // table may not exist yet
    return result;
  }

  if (!events || events.length === 0) return result;

  const eventList = events
    .map((e: any) => {
      const t = new Date(e.start_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      return `${t} — ${e.title}${e.location ? ` (${e.location})` : ""}`;
    })
    .join(", ");

  await sb.from("mavis_tasks").insert({
    user_id: userId,
    type: "calendar",
    description: `Upcoming in the next 2 hours: ${eventList}. Prepare and review any relevant materials.`,
    payload: {
      events: events.map((e: any) => ({ id: e.id, title: e.title, start_time: e.start_time })),
    },
    status: "pending",
  });

  result.issues = events.length;
  result.actions = 1;
  result.details = { upcoming_events: events.length, events: eventList };
  return result;
}

// ── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const sb = createClient(SB_URL, SB_KEY);

    // Fetch all profiles active within the last 7 days.
    // We join via auth.users last_sign_in_at via mavis_memory activity as a proxy
    // since profiles.updated_at is bumped on any profile write.
    const sevenDaysAgo = daysAgo(7);

    // Get distinct user_ids that have had memory activity in the last 7 days
    // (more reliable than profiles.updated_at for detecting real usage)
    const { data: activeRows, error: activeErr } = await sb
      .from("mavis_memory")
      .select("user_id")
      .gte("created_at", sevenDaysAgo)
      .order("user_id");

    if (activeErr) {
      console.error("[ambient-monitor] Failed to fetch active users:", activeErr.message);
      return json({ error: activeErr.message }, 500);
    }

    // Deduplicate user ids
    const userIds: string[] = [
      ...new Set((activeRows ?? []).map((r: any) => String(r.user_id))),
    ];

    if (userIds.length === 0) {
      return json({ processed: 0, issues: 0, message: "No active users found" });
    }

    let totalProcessed = 0;
    let totalIssues = 0;

    for (const userId of userIds) {
      try {
        // Run all 5 checks in parallel
        const [q1, q2, q3, q4, q5] = await Promise.all([
          checkOverdueQuests(sb, userId),
          checkHealthAnomalies(sb, userId),
          checkPriorityEmails(sb, userId),
          checkRevenueMentions(sb, userId),
          checkUpcomingEvents(sb, userId),
        ]);

        const results = [q1, q2, q3, q4, q5];
        const issuesFound = results.reduce((sum, r) => sum + r.issues, 0);
        const actionsTaken = results.reduce((sum, r) => sum + r.actions, 0);

        // Always write an ambient event record so we have an audit trail
        await sb.from("mavis_ambient_events").insert({
          user_id: userId,
          checks_run: 5,
          issues_found: issuesFound,
          actions_taken: actionsTaken,
          details: {
            overdue_quests: q1.details,
            health_anomalies: q2.details,
            priority_emails: q3.details,
            revenue_gap: q4.details,
            upcoming_events: q5.details,
          },
          created_at: nowIso(),
        });

        // Send push notification if there are any issues
        if (issuesFound > 0) {
          const summaryParts: string[] = [];
          if (q1.issues > 0) summaryParts.push(`${q1.issues} overdue quest(s)`);
          if (q2.issues > 0) summaryParts.push(`health anomaly detected`);
          if (q3.issues > 0) summaryParts.push(`${q3.issues} priority email(s)`);
          if (q4.issues > 0) summaryParts.push(`no revenue review in 7 days`);
          if (q5.issues > 0) summaryParts.push(`${q5.issues} upcoming event(s)`);
          const summary = summaryParts.join(" • ");

          await callEdgeFunction("mavis-push-notify", {
            user_id: userId,
            title: "MAVIS Alert",
            body: summary,
            data: { type: "ambient_monitor", issues: String(issuesFound) },
          });
        }

        totalIssues += issuesFound;
        totalProcessed++;
      } catch (userErr: unknown) {
        const msg = userErr instanceof Error ? userErr.message : String(userErr);
        console.error(`[ambient-monitor] Error processing user ${userId}:`, msg);
        // Continue with next user — don't abort the whole run
      }
    }

    return json({ processed: totalProcessed, issues: totalIssues });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ambient-monitor] Fatal error:", message);
    return json({ error: message }, 500);
  }
});
