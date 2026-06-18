// MAVIS Weekly Retrospective
// Fires every Sunday at 18:00 UTC. Generates a structured weekly performance review,
// sends it via Telegram, and saves it as a journal entry. Also callable via POST.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID   = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…[truncated]" : text;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: payload }),
  }).catch(() => {});
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID");
    if (!uid) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

    // Compute time windows
    const now = new Date();
    const weekStart     = new Date(now.getTime() - 7  * 86400000).toISOString();
    const weekEnd       = now.toISOString();
    const prevWeekStart = new Date(now.getTime() - 14 * 86400000).toISOString();
    const prevWeekEnd   = weekStart;

    // Run all queries in parallel
    const [
      questsCompletedRes,   // a
      activeNewQuestsRes,   // b
      allHabitsRes,         // c
      habitsActiveRes,      // d
      revenueThisRes,       // e
      revenueLastRes,       // f
      expensesRes,          // g
      goalsRes,             // h
      journalRes,           // i
      topStreaksRes,         // j
      newNotesRes,          // k
      tasksCompletedRes,    // l
      bondRes,              // m
    ] = await Promise.all([
      // a. Quests completed this week
      supabase
        .from("quests")
        .select("id, title")
        .eq("user_id", uid)
        .eq("status", "completed")
        .gte("updated_at", weekStart),

      // b. Quests still active (not completed) started this week
      supabase
        .from("quests")
        .select("id, title")
        .eq("user_id", uid)
        .eq("status", "active")
        .gte("created_at", weekStart),

      // c. All active habits
      supabase
        .from("tasks")
        .select("title, streak, completed_count, updated_at")
        .eq("type", "habit")
        .eq("status", "active"),

      // d. Habits with updated_at this week (active this week)
      supabase
        .from("tasks")
        .select("title, streak, completed_count, updated_at")
        .eq("type", "habit")
        .eq("status", "active")
        .gte("updated_at", weekStart),

      // e. Revenue this week
      supabase
        .from("mavis_revenue")
        .select("amount")
        .gte("created_at", weekStart),

      // f. Revenue last week
      supabase
        .from("mavis_revenue")
        .select("amount")
        .gte("created_at", prevWeekStart)
        .lt("created_at", prevWeekEnd),

      // g. Expenses this week
      supabase
        .from("mavis_expenses")
        .select("amount")
        .gte("expense_date", weekStart.slice(0, 10)),

      // h. Active goals
      supabase
        .from("mavis_goals")
        .select("objective, quest_ids, decomposed")
        .eq("status", "active"),

      // i. Journal entries this week
      supabase
        .from("journal_entries")
        .select("title, mood, created_at")
        .gte("created_at", weekStart)
        .limit(10),

      // j. Top stacked habits by streak
      supabase
        .from("tasks")
        .select("title, streak")
        .eq("type", "habit")
        .eq("status", "active")
        .order("streak", { ascending: false })
        .limit(5),

      // k. New notes added to vault this week (count only)
      supabase
        .from("mavis_notes")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekStart),

      // l. Tasks completed this week (count only)
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("updated_at", weekStart),

      // m. Bond data
      supabase
        .from("mavis_bond")
        .select("interaction_count, trust_level")
        .eq("user_id", uid)
        .single(),
    ]);

    // Compute metrics
    const questsCompleted      = questsCompletedRes.data ?? [];
    const activeNewQuests      = activeNewQuestsRes.data ?? [];
    const allHabits            = allHabitsRes.data ?? [];
    const habitsActiveThisWeek = (habitsActiveRes.data ?? []).length;
    const totalHabits          = allHabits.length;
    const habitAdherenceRate   = totalHabits > 0
      ? (habitsActiveThisWeek / totalHabits) * 100
      : 0;

    const questsCompletedCount = questsCompleted.length;

    const revenueThisWeek = (revenueThisRes.data ?? []).reduce(
      (sum: number, r: { amount: number }) => sum + (r.amount ?? 0), 0,
    );
    const revenueLastWeek = (revenueLastRes.data ?? []).reduce(
      (sum: number, r: { amount: number }) => sum + (r.amount ?? 0), 0,
    );
    const revenueDelta    = revenueThisWeek - revenueLastWeek;
    const revenueDeltaPct = revenueLastWeek > 0
      ? (revenueDelta / revenueLastWeek) * 100
      : null;

    const expensesThisWeek = (expensesRes.data ?? []).reduce(
      (sum: number, e: { amount: number }) => sum + (e.amount ?? 0), 0,
    );

    const goals          = goalsRes.data ?? [];
    const journalCount   = (journalRes.data ?? []).length;
    const topStreaks      = topStreaksRes.data ?? [];
    const newNotesCount  = newNotesRes.count ?? 0;
    const tasksCompletedCount = tasksCompletedRes.count ?? 0;
    const bond           = bondRes.data;

    // Build context for Claude
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    const contextStr = `WEEKLY PERFORMANCE DATA (week ending ${dateStr}):

QUESTS: ${questsCompletedCount} completed this week. ${activeNewQuests.length} new quests started.
TASKS: ${tasksCompletedCount} tasks completed.
HABITS: ${habitsActiveThisWeek}/${totalHabits} habits active this week (${habitAdherenceRate.toFixed(0)}% adherence). Top streaks: ${topStreaks.map((t: { title: string; streak: number }) => `${t.title} (${t.streak}d)`).join(", ") || "none"}.
REVENUE: $${revenueThisWeek.toFixed(2)} this week vs $${revenueLastWeek.toFixed(2)} last week (${revenueDeltaPct !== null ? (revenueDeltaPct >= 0 ? "+" : "") + revenueDeltaPct.toFixed(0) + "%" : "no prior data"}).
EXPENSES: $${expensesThisWeek.toFixed(2)} this week.
NET: $${(revenueThisWeek - expensesThisWeek).toFixed(2)}.
JOURNAL: ${journalCount} entries this week.
VAULT: ${newNotesCount} new notes captured.
GOALS: ${goals.map((g: { objective: string }) => g.objective.slice(0, 60)).join(" | ") || "none active"}.`;

    // Call Claude Sonnet for the retrospective
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: "You are MAVIS — an AI personal OS. Generate a structured weekly retrospective for your operator. Be analytical, direct, and forward-looking. Use military precision. Format: 3 sections — WINS (bullet points of what went well), GAPS (what fell short, no judgment, just data), NEXT WEEK (3 specific action recommendations). Max 400 words total. No fluff.",
        messages: [
          { role: "user", content: contextStr },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} — ${err}`);
    }

    const claudeJson    = await claudeRes.json();
    const claudeReview: string = claudeJson.content?.[0]?.text ?? "(no review generated)";

    // Build Telegram message
    const revDeltaStr = revenueDeltaPct !== null
      ? `${revenueDeltaPct >= 0 ? "+" : ""}${revenueDeltaPct.toFixed(0)}%`
      : "—";

    const telegramMsg = `MAVIS WEEKLY RETRO — ${dateStr}
─────────────────────────
METRICS
Quests: ${questsCompletedCount} completed | Habits: ${habitAdherenceRate.toFixed(0)}% adherence
Revenue: $${revenueThisWeek.toFixed(2)} (${revDeltaStr} WoW)
Tasks: ${tasksCompletedCount} done | Journal: ${journalCount} entries | Notes: ${newNotesCount} added

${claudeReview}

─────
Bond: ${bond?.interaction_count ?? 0} interactions · Trust: ${bond?.trust_level ?? "—"}`;

    // Send via Telegram
    await sendTelegram(telegramMsg);

    // Save as journal entry
    await supabase
      .from("journal_entries")
      .insert({
        user_id: uid,
        title: `Weekly Retrospective — ${dateStr}`,
        content: claudeReview,
        mood: "reflective",
        tags: ["weekly-retro", "mavis-generated"],
      });

    return new Response(
      JSON.stringify({
        ok: true,
        metrics: {
          questsCompletedCount,
          habitAdherenceRate,
          revenueThisWeek,
          tasksCompletedCount,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (err) {
    console.error("mavis-weekly-retro error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
