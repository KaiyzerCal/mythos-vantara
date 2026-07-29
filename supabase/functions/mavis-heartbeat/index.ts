// MAVIS Heartbeat — proactive autonomous check-in, runs hourly via pg_cron.
// Checks operator state across all MAVIS systems and pushes alerts + queues tasks.
//
// Checks (in order):
//   1. Stalled quests (active, idle 7+ days) → Telegram nudge
//   2. Habit streaks at risk (streak > 0, not completed today) → Telegram alert
//   3. Calendar events in next 2h → pre-brief
//   4. Goals with no recent activity → push to chat context
//   5. Pending mavis_tasks → execute up to 3 tasks via task-executor
//
// Also writes a heartbeat_log entry to mavis_memory for observability.
//
// Requires: TELEGRAM_BOT_TOKEN + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL   = Deno.env.get("SUPABASE_URL")!;
const SB_SRK   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function tgSend(chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

async function runHeartbeatForUser(sb: any, userId: string): Promise<Record<string, unknown>> {
  const now = new Date();
  const sevenDaysAgo   = new Date(Date.now() - 7 * 86400_000).toISOString();
  const twoDaysAgo     = new Date(Date.now() - 2 * 86400_000).toISOString();
  const twoHoursFromNow = new Date(Date.now() + 2 * 3600_000).toISOString();
  const startOfDay     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const alerts: string[] = [];
  const log: Record<string, unknown> = { userId, timestamp: now.toISOString(), checks: {} };

  // ── 1. Stalled quests ──────────────────────────────────────────────────────
  const { data: stalledQuests } = await sb
    .from("quests")
    .select("title")
    .eq("user_id", userId)
    .eq("status", "active")
    .lt("updated_at", sevenDaysAgo)
    .limit(5);

  if (stalledQuests?.length) {
    const titles = (stalledQuests as any[]).map((q: any) => q.title).join(", ");
    alerts.push(`⚠️ <b>Stalled Quests</b> (idle 7+ days): ${titles}`);
    (log.checks as any).stalled_quests = stalledQuests.length;
  }

  // ── 2. Habit streaks at risk ───────────────────────────────────────────────
  const { data: atRiskHabits } = await sb
    .from("tasks")
    .select("title, streak")
    .eq("user_id", userId)
    .eq("type", "habit")
    .gt("streak", 0)
    .lt("updated_at", twoDaysAgo)
    .limit(5);

  if (atRiskHabits?.length) {
    const titles = (atRiskHabits as any[]).map((t: any) => `${t.title} (${t.streak}d streak)`).join(", ");
    alerts.push(`🔥 <b>Streak Alert</b>: ${titles} — complete today to keep your streak alive`);
    (log.checks as any).at_risk_habits = atRiskHabits.length;
  }

  // ── 3. Calendar events in next 2h ─────────────────────────────────────────
  // Only check if Google Calendar is connected
  const { data: integration } = await sb
    .from("mavis_user_integrations")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();

  if (integration) {
    // Call mavis-calendar-agent directly (mavis-actions has no calendar_agent type).
    const calRes = await fetch(`${SB_URL}/functions/v1/mavis-calendar-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
      body: JSON.stringify({ userId, action: "get_all_events", time_min: now.toISOString(), time_max: twoHoursFromNow }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (calRes?.ok) {
      const calData = await calRes.json().catch(() => ({})) as any;
      // calendar-agent returns { ok, result } where result is Google's list payload
      const events = calData?.result?.items ?? calData?.result?.events ?? calData?.events ?? [];
      if (events.length) {
        const titles = events.slice(0, 3).map((e: any) => `${e.summary} @ ${new Date(e.start?.dateTime ?? e.start?.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`).join(", ");
        alerts.push(`📅 <b>Coming Up</b> (next 2h): ${titles}`);
        (log.checks as any).upcoming_events = events.length;
      }
    }
  }

  // ── 4. Active plans — autonomous step execution ───────────────────────────
  // Check autonomy permission for advance_plan before proceeding
  const { data: planPermRow } = await sb
    .from("mavis_autonomy_settings")
    .select("permission_level")
    .eq("user_id", userId)
    .eq("action_category", "advance_plan")
    .maybeSingle();
  const planPermission = (planPermRow as any)?.permission_level ?? "always"; // default: always allowed

  const { data: activePlans } = await sb
    .from("mavis_plans")
    .select("id, title, current_step, steps")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(3);

  if (activePlans?.length && planPermission !== "never") {
    (log.checks as any).active_plans = activePlans.length;
    let autoExecuted = 0;

    // Keywords that indicate a step can be executed autonomously
    const AUTO_KEYWORDS   = /search|research|look up|find info|draft|write|summarize|review|analyze|check/i;
    // Keywords that require human involvement — skip auto-execution
    const HUMAN_KEYWORDS  = /\bcall\b|\bmeet\b|\btalk\b|\bdecide\b|\bchoose\b|\bbuy\b|\bapprove\b/i;

    for (const plan of activePlans as any[]) {
      const steps = Array.isArray(plan.steps) ? plan.steps : [];
      const current = steps[plan.current_step];
      const stepDesc = String(current?.step ?? current?.description ?? "").trim();
      const stepNum  = plan.current_step + 1;
      const stepTotal = steps.length;

      if (!stepDesc) {
        alerts.push(`🎯 <b>Active Plan</b>: "${plan.title}" — Step ${stepNum}/${stepTotal} (no description)`);
        continue;
      }

      const canAuto  = AUTO_KEYWORDS.test(stepDesc) && !HUMAN_KEYWORDS.test(stepDesc);
      const needsHuman = HUMAN_KEYWORDS.test(stepDesc);

      if (canAuto) {
        // Determine action type from step text for mavis-actions
        let actionType = "create_note";
        if (/search|look up|find info/i.test(stepDesc))   actionType = "web_search";
        else if (/research/i.test(stepDesc))               actionType = "web_search";
        else if (/draft|write/i.test(stepDesc))            actionType = "create_note";
        else if (/summarize|review|analyze|check/i.test(stepDesc)) actionType = "create_note";

        // Fire action (fire-and-forget)
        fetch(`${SB_URL}/functions/v1/mavis-actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
          body: JSON.stringify({
            userId,
            actions: [{
              type: actionType,
              params: {
                query:   stepDesc.slice(0, 120),
                content: `Auto-executed plan step: ${stepDesc}`,
                title:   `Plan step: ${plan.title} — Step ${stepNum}`,
              },
            }],
          }),
          signal: AbortSignal.timeout(20_000),
        }).catch(() => {});

        // Advance the plan step
        fetch(`${SB_URL}/functions/v1/mavis-plans`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
          body: JSON.stringify({
            userId,
            action:  "advance_step",
            plan_id: plan.id,
            notes:   "Auto-executed by MAVIS heartbeat",
          }),
          signal: AbortSignal.timeout(20_000),
        }).catch(() => {});

        autoExecuted++;
        alerts.push(`✅ <b>Plan Auto-step</b>: "${plan.title}" — executed Step ${stepNum}/${stepTotal}: ${stepDesc.slice(0, 80)}`);
      } else if (needsHuman) {
        alerts.push(`🎯 <b>Active Plan</b>: "${plan.title}" — Step ${stepNum}/${stepTotal} needs you: ${stepDesc.slice(0, 80)}`);
      } else {
        alerts.push(`🎯 <b>Active Plan</b>: "${plan.title}" — Step ${stepNum}/${stepTotal}: ${stepDesc.slice(0, 80)}`);
      }
    }

    (log.checks as any).auto_executed_steps = autoExecuted;
  }

  // ── 5. Pending tasks in mavis_tasks ───────────────────────────────────────
  const { data: pendingTasks } = await sb
    .from("mavis_tasks")
    .select("id, type, description")
    .eq("user_id", userId)
    .eq("status", "pending")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(3);

  if (pendingTasks?.length) {
    (log.checks as any).pending_tasks = pendingTasks.length;
    // Trigger task executor for each (fire-and-forget)
    for (const task of pendingTasks as any[]) {
      fetch(`${SB_URL}/functions/v1/mavis-task-executor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
        body: JSON.stringify({ task_id: task.id }),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {});
    }
  }

  // ── Send consolidated Telegram alert (content-deduplicated) ───────────────
  // Structural guard against exactly this failure: the cron interval was
  // separately fixed (was misconfigured to every 5 min instead of hourly —
  // see 20260729000000_fix_heartbeat_cron_interval.sql), but a schedule fix
  // alone is fragile — anything that fires this function more often than
  // intended, or the mere fact that stalled items haven't changed hour to
  // hour, would still nag the operator with an identical alert. Only send
  // if this run's alert set actually differs from the last one sent, or the
  // cooldown has elapsed — whichever comes first.
  const COOLDOWN_MS = 4 * 3600_000; // don't repeat an unchanged alert set within 4h
  const alertSignature = alerts.join("|");
  if (alerts.length) {
    const { data: recentHeartbeat } = await sb
      .from("mavis_memory")
      .select("content, timestamp")
      .eq("user_id", userId)
      .eq("session_id", "heartbeat")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastSignature = String((recentHeartbeat as any)?.content ?? "").match(/\[SIG:([\s\S]*)\]$/)?.[1];
    const lastTimestamp = (recentHeartbeat as any)?.timestamp as number | undefined;
    const withinCooldown = !!lastTimestamp && (Date.now() - lastTimestamp) < COOLDOWN_MS;
    const unchanged = withinCooldown && lastSignature === alertSignature;

    if (!unchanged) {
      // Resolve Telegram chat ID from the linked-accounts table, falling back
      // to the operator env vars. (There is no profiles.telegram_chat_id column.)
      const { data: linked } = await sb
        .from("telegram_linked_accounts")
        .select("telegram_user_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const chatId = (linked as any)?.telegram_user_id
        ?? Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID")
        ?? Deno.env.get("TELEGRAM_CHAT_ID");
      if (chatId) {
        const msg = `🤖 <b>MAVIS Heartbeat</b> — ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} UTC\n\n${alerts.join("\n\n")}`;
        await tgSend(chatId, msg);
      }
    }
  }

  // ── Log heartbeat to mavis_memory ─────────────────────────────────────────
  // Schema: session_id, role, content, timestamp all NOT NULL; no tags column.
  // Alert signature embedded at the end (opaque to anything reading this as
  // a plain log line) so the next run can compare against it above.
  await Promise.resolve(sb.from("mavis_memory").insert({
    user_id: userId,
    session_id: "heartbeat",
    role: "system",
    content: `Heartbeat: ${alerts.length} alert(s). ${JSON.stringify(log.checks)} [SIG:${alertSignature}]`,
    timestamp: Date.now(),
    consolidated: false,
  })).catch(() => {});

  return { ...log, alerts_sent: alerts.length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

    // Get all active users (those with recent activity in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: activeUsers } = await sb
      .from("mavis_memory")
      .select("user_id")
      .gte("created_at", thirtyDaysAgo)
      .order("user_id");

    // Deduplicate user IDs
    const userIds = [...new Set((activeUsers ?? []).map((r: any) => r.user_id as string))];

    const results: Record<string, unknown>[] = [];
    for (const userId of userIds.slice(0, 50)) { // cap at 50 users per run
      try {
        const result = await runHeartbeatForUser(sb, userId);
        results.push(result);
      } catch (e: any) {
        results.push({ userId, error: e.message });
      }
    }

    return new Response(JSON.stringify({ users_checked: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
