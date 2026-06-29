import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Anthropic API error ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  return json.content?.[0]?.text ?? "";
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const resp = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    },
  );
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed ${resp.status}: ${err}`);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Env vars ─────────────────────────────────────────────────────────────
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TELEGRAM_OPERATOR_CHAT_ID = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID");
    const TELEGRAM_OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OPERATOR_CHAT_ID || !TELEGRAM_OPERATOR_USER_ID) {
      return new Response(
        JSON.stringify({ error: "Missing TELEGRAM_* environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const uid = TELEGRAM_OPERATOR_USER_ID;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const deadline48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const staleThreshold = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const confirmThreshold = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    // ── Run all queries in parallel ───────────────────────────────────────────
    const fiveDaysAgo  = new Date(now.getTime() -  5 * 86400000);
    const tenDaysAgo   = new Date(now.getTime() - 10 * 86400000);
    const sevenDaysAgo = new Date(now.getTime() -  7 * 86400000);
    const thirtyDaysAgo= new Date(now.getTime() - 30 * 86400000);
    const threeDaysAgo = new Date(now.getTime() - 72 * 3600000);

    const [
      nearDeadlineResult,
      stalledHabitsResult,
      revenueThisWeekResult,
      revenueLastWeekResult,
      stalledQuestsResult,
      pendingConfirmResult,
      recentJournalResult,
      staleGoalsResult,
      last7ExpensesResult,
      last30ExpensesResult,
      recentChatResult,
    ] = await Promise.all([
      // 1. Quests with deadline in next 48h
      supabase
        .from("quests")
        .select("id, title, deadline, status")
        .eq("status", "active")
        .gte("deadline", now.toISOString())
        .lte("deadline", deadline48h.toISOString()),

      // 2. Habits not completed today (streak > 0, not updated today)
      supabase
        .from("tasks")
        .select("id, title, streak, updated_at")
        .eq("user_id", uid)
        .eq("type", "habit")
        .eq("status", "active")
        .gt("streak", 0)
        .lt("updated_at", todayStart.toISOString()),

      // 3. Revenue this week
      supabase
        .from("mavis_revenue")
        .select("amount")
        .gte("created_at", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()),

      // 4. Revenue last week (for comparison)
      supabase
        .from("mavis_revenue")
        .select("amount")
        .gte("created_at", new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .lt("created_at", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()),

      // 5. Stalled quests (no update in 5+ days, still active)
      supabase
        .from("quests")
        .select("id, title, updated_at")
        .eq("status", "active")
        .lt("updated_at", staleThreshold.toISOString()),

      // 6. mavis_tasks requiring confirmation older than 4h
      supabase
        .from("mavis_tasks")
        .select("id, title, created_at")
        .eq("status", "requires_confirmation")
        .lt("created_at", confirmThreshold.toISOString()),

      // 7. Journal silence check
      supabase.from("journal_entries")
        .select("id, created_at").eq("user_id", uid)
        .gte("created_at", fiveDaysAgo.toISOString()).limit(1),

      // 8. Goals not updated in 10+ days
      supabase.from("mavis_goals")
        .select("id, objective, updated_at").eq("user_id", uid)
        .eq("status", "active")
        .lt("updated_at", tenDaysAgo.toISOString()).limit(3),

      // 9. Last 7 days expenses
      supabase.from("mavis_expenses")
        .select("amount").eq("user_id", uid)
        .gte("expense_date", sevenDaysAgo.toISOString().slice(0, 10)),

      // 10. Last 30 days expenses (for weekly avg)
      supabase.from("mavis_expenses")
        .select("amount").eq("user_id", uid)
        .gte("expense_date", thirtyDaysAgo.toISOString().slice(0, 10)),

      // 11. Recent MAVIS chat activity
      supabase.from("chat_messages")
        .select("id").eq("user_id", uid).eq("role", "user")
        .gte("created_at", threeDaysAgo.toISOString()).limit(1),
    ]);

    // ── Analyse results ───────────────────────────────────────────────────────
    const urgencies: string[] = [];
    const contextParts: string[] = [];

    // Near-deadline quests
    const nearDeadlineQuests = nearDeadlineResult.data ?? [];
    if (nearDeadlineQuests.length > 0) {
      const names = nearDeadlineQuests
        .map((q) => {
          const dl = new Date(q.deadline);
          const hoursLeft = Math.round((dl.getTime() - now.getTime()) / 3600000);
          return `"${q.title}" (${hoursLeft}h remaining)`;
        })
        .join(", ");
      urgencies.push(`${nearDeadlineQuests.length} quest(s) due in <48h`);
      contextParts.push(`NEAR-DEADLINE QUESTS: ${names}`);
    }

    // Stalled habits at risk
    const stalledHabits = stalledHabitsResult.data ?? [];
    if (stalledHabits.length > 0) {
      const names = stalledHabits
        .map((h) => `"${h.title}" (streak: ${h.streak})`)
        .join(", ");
      urgencies.push(`${stalledHabits.length} habit streak(s) at risk today`);
      contextParts.push(`HABITS AT RISK: ${names}`);
    }

    // Revenue comparison
    const revenueThisWeek = (revenueThisWeekResult.data ?? []).reduce(
      (sum: number, r: { amount: number }) => sum + (r.amount ?? 0),
      0,
    );
    const revenueLastWeek = (revenueLastWeekResult.data ?? []).reduce(
      (sum: number, r: { amount: number }) => sum + (r.amount ?? 0),
      0,
    );
    const revenueDelta = revenueThisWeek - revenueLastWeek;
    const revenuePct =
      revenueLastWeek > 0
        ? Math.round((revenueDelta / revenueLastWeek) * 100)
        : revenueThisWeek > 0
        ? 100
        : 0;
    if (Math.abs(revenuePct) >= 20 || revenueThisWeek === 0) {
      const trend = revenueDelta >= 0 ? "UP" : "DOWN";
      urgencies.push(`Revenue ${trend} ${Math.abs(revenuePct)}% vs last week`);
      contextParts.push(
        `REVENUE: This week $${revenueThisWeek.toFixed(2)} vs last week $${revenueLastWeek.toFixed(2)} (${trend} ${Math.abs(revenuePct)}%)`,
      );
    } else {
      contextParts.push(
        `REVENUE: This week $${revenueThisWeek.toFixed(2)} vs last week $${revenueLastWeek.toFixed(2)}`,
      );
    }

    // Stalled quests
    const stalledQuests = stalledQuestsResult.data ?? [];
    if (stalledQuests.length > 0) {
      const names = stalledQuests
        .map((q) => {
          const daysStale = Math.floor(
            (now.getTime() - new Date(q.updated_at).getTime()) / 86400000,
          );
          return `"${q.title}" (${daysStale}d stale)`;
        })
        .join(", ");
      urgencies.push(`${stalledQuests.length} quest(s) stalled 5+ days`);
      contextParts.push(`STALLED QUESTS: ${names}`);
    }

    // Pending confirmations
    const pendingConfirm = pendingConfirmResult.data ?? [];
    if (pendingConfirm.length > 0) {
      const names = pendingConfirm.map((t) => `"${t.title}"`).join(", ");
      urgencies.push(`${pendingConfirm.length} task(s) awaiting confirmation >4h`);
      contextParts.push(`AWAITING CONFIRMATION: ${names}`);
    }

    // Journal silence
    if (!recentJournalResult.data?.length) {
      urgencies.push("No journal entry in 5+ days");
      contextParts.push("JOURNAL SILENCE: User hasn't reflected in 5+ days — system calibration degrading");
    }

    // Stale goals
    const staleGoals = staleGoalsResult.data ?? [];
    if (staleGoals.length > 0) {
      const names = staleGoals.map((g: any) => {
        const days = Math.round((now.getTime() - new Date(g.updated_at).getTime()) / 86400000);
        return `"${g.objective.slice(0, 50)}" (${days}d without update)`;
      }).join(", ");
      urgencies.push(`${staleGoals.length} goal(s) need check-in`);
      contextParts.push(`STALE GOALS: ${names}`);
    }

    // Budget spike
    const total7d  = (last7ExpensesResult.data  ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0);
    const total30d = (last30ExpensesResult.data ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0);
    const avgWeekly = total30d / 4;
    if (avgWeekly > 10 && total7d > avgWeekly * 2) {
      urgencies.push(`Spending spike: $${total7d.toFixed(0)} this week vs $${avgWeekly.toFixed(0)} avg`);
      contextParts.push(`BUDGET SPIKE: This week $${total7d.toFixed(2)} vs weekly avg $${avgWeekly.toFixed(2)} (${Math.round(total7d / avgWeekly)}× normal)`);
    }

    // Idle user
    if (!recentChatResult.data?.length) {
      urgencies.push("No MAVIS interaction in 72+ hours");
      contextParts.push("IDLE: User hasn't engaged with MAVIS in 3+ days");
    }

    // ── Nothing urgent — skip nudge ───────────────────────────────────────────
    if (urgencies.length === 0) {
      return new Response(
        JSON.stringify({ nudged: false, reason: "nothing urgent" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build Claude prompt ───────────────────────────────────────────────────
    const contextString = [
      `Current time: ${now.toUTCString()}`,
      `Urgency count: ${urgencies.length}`,
      "",
      contextParts.join("\n"),
    ].join("\n");

    const systemPrompt =
      "You are MAVIS, an AI personal OS. Generate a brief, focused mid-day nudge message for your operator (3-5 lines max). Be direct, use military precision. Reference the specific urgencies. No fluff.";

    let nudgeText: string;
    try {
      nudgeText = await callClaude(ANTHROPIC_API_KEY, systemPrompt, contextString);
    } catch (claudeErr) {
      console.error("Claude call failed:", claudeErr);
      // Fallback: plain urgency list
      nudgeText = urgencies.map((u) => `• ${u}`).join("\n");
    }

    // ── Staged notification deduplication (OpenHuman Heartbeat pattern) ──────
    // Compute a stable dedupe key from urgency content + 1-hour bucket
    // so the same nudge can't fire more than once per stage per hour.
    const hourBucket = Math.floor(now.getTime() / 3600000);
    const dedupeContent = urgencies.slice().sort().join("|");
    const dedupeKey = `nudge|${dedupeContent.slice(0, 80)}|${hourBucket}`;
    const stage = "general";
    const expiresAt = new Date(now.getTime() + 25 * 3600000).toISOString(); // 25h TTL

    let alreadySent = false;
    try {
      const { error: stageErr } = await supabase
        .from("notification_stages")
        .insert({ user_id: uid, dedupe_key: dedupeKey, stage, event_ref: urgencies[0], expires_at: expiresAt });
      // unique constraint violation = already sent this hour
      if (stageErr?.code === "23505") alreadySent = true;
    } catch { /* non-critical — proceed with send */ }

    if (alreadySent) {
      return new Response(
        JSON.stringify({ nudged: false, reason: "dedupe: already sent this hour" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Send via Telegram ─────────────────────────────────────────────────────
    const prefix = "MAVIS MID-DAY ⚡\n─────\n";
    await sendTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_OPERATOR_CHAT_ID, prefix + nudgeText);

    // ── Also push to in-app mavis_insights for Notifications page ────────────
    supabase.from("mavis_insights").insert({
      user_id: uid,
      title: `Mid-day nudge: ${urgencies.length} item${urgencies.length !== 1 ? "s" : ""} need attention`,
      content: nudgeText,
      category: "nudge",
      severity: urgencies.length > 2 ? "warning" : "info",
      source: "proactive_nudge",
    }).catch(() => {});

    return new Response(
      JSON.stringify({ nudged: true, urgencies }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error in mavis-proactive-nudge:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
