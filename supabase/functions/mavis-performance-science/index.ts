// mavis-performance-science
// Generates a daily performance score (0-100) and optimal scheduling recommendations
// by correlating biometrics, habits, task completion, and output data.
// Runs daily at 7:05am after morning brief. Also callable on-demand.
// verify_jwt = false (cron + service-role)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function callClaude(system: string, user: string, maxTokens = 400): Promise<string> {
  if (!ANTHROPIC_KEY) return "";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) return "";
  const d = await res.json();
  return d.content?.find((b: any) => b.type === "text")?.text ?? "";
}

async function computeScore(userId: string): Promise<{
  score: number;
  components: Record<string, number>;
  optimal_window: string;
  trend: string;
  recommendation: string;
  raw_data: Record<string, unknown>;
}> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

  const [
    healthRes, energyRes, tasksRes, questsRes,
    behaviorRes, scoreHistoryRes, revenueRes, habitsRes,
  ] = await Promise.all([
    // Health metrics — sleep, HRV, resting HR from wearables
    sb.from("health_metrics").select("metric_type,value,recorded_at").eq("user_id", userId).gte("recorded_at", sevenDaysAgo).order("recorded_at", { ascending: false }).limit(30),
    // Energy system entries
    sb.from("energy_systems").select("current_energy,max_energy,updated_at").eq("user_id", userId).maybeSingle(),
    // Task completion yesterday
    sb.from("tasks").select("status,completed_at,recurrence").eq("user_id", userId).gte("updated_at", yesterday + "T00:00:00Z"),
    // Quest activity
    sb.from("quests").select("status,updated_at,type").eq("user_id", userId).gte("updated_at", sevenDaysAgo),
    // Behavioral patterns (peak hours)
    sb.from("mavis_behavioral_patterns").select("pattern_data").eq("user_id", userId).eq("pattern_type", "interaction_analysis").maybeSingle(),
    // Last 7 days of scores for trend
    sb.from("mavis_daily_scores").select("score,score_date").eq("user_id", userId).order("score_date", { ascending: false }).limit(7),
    // Revenue signal (yesterday)
    sb.from("mavis_revenue").select("amount").eq("user_id", userId).gte("created_at", yesterday + "T00:00:00Z"),
    // Habit streaks
    sb.from("tasks").select("title,streak,type").eq("user_id", userId).eq("type", "habit").eq("status", "active").order("streak", { ascending: false }).limit(10),
  ]);

  const health = healthRes.data ?? [];
  const energy = energyRes.data;
  const tasks = tasksRes.data ?? [];
  const quests = questsRes.data ?? [];
  const behavior = (behaviorRes.data as any)?.pattern_data ?? {};
  const scoreHistory = scoreHistoryRes.data ?? [];
  const revenue = revenueRes.data ?? [];
  const habits = habitsRes.data ?? [];

  // ── Component scoring ──────────────────────────────────────────────────

  // Sleep score (0-100): based on sleep duration/quality metrics
  const sleepMetrics = health.filter((h: any) => ["sleep_duration", "sleep_score", "sleep_quality"].includes(h.metric_type));
  let sleepScore = 70; // default if no wearable data
  if (sleepMetrics.length > 0) {
    const latest = sleepMetrics[0];
    if (latest.metric_type === "sleep_score" || latest.metric_type === "sleep_quality") {
      sleepScore = Math.min(100, Math.max(0, Number(latest.value)));
    } else if (latest.metric_type === "sleep_duration") {
      // 7-9 hours = optimal (100), less/more = reduced
      const hours = Number(latest.value) / 3600; // assume seconds if large, hours if small
      const h = hours > 24 ? hours / 3600 : hours;
      sleepScore = h >= 7 && h <= 9 ? 100 : h >= 6 ? 75 : h >= 5 ? 50 : 30;
    }
  }

  // HRV score (0-100): higher HRV = better recovery
  const hrvMetrics = health.filter((h: any) => h.metric_type === "hrv");
  let hrvScore = 70;
  if (hrvMetrics.length > 0) {
    const hrv = Number(hrvMetrics[0].value);
    // Typical ranges: <30 poor, 30-60 average, 60-100 good, 100+ excellent
    hrvScore = Math.min(100, Math.max(0, hrv >= 100 ? 100 : hrv >= 60 ? 80 : hrv >= 30 ? 60 : 40));
  }

  // Energy score (0-100)
  let energyScore = 70;
  if (energy) {
    const pct = (energy.max_energy > 0) ? (energy.current_energy / energy.max_energy) * 100 : 70;
    energyScore = Math.round(Math.min(100, Math.max(0, pct)));
  }

  // Task completion score (0-100)
  const completedToday = tasks.filter((t: any) => t.status === "completed").length;
  const totalTasks = tasks.length;
  let taskScore = totalTasks > 0 ? Math.round((completedToday / totalTasks) * 100) : 70;

  // Habit streak score (0-100): average streak health
  let habitScore = 70;
  if (habits.length > 0) {
    const avgStreak = habits.reduce((s: number, h: any) => s + (Number(h.streak) || 0), 0) / habits.length;
    habitScore = Math.min(100, Math.round(avgStreak * 3)); // 33+ day avg = 100
  }

  // Output score (0-100): revenue + quest completions
  const revenueYesterday = revenue.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const questsCompleted = quests.filter((q: any) => q.status === "completed").length;
  let outputScore = 60;
  if (revenueYesterday > 0) outputScore = Math.min(100, outputScore + 30);
  if (questsCompleted > 0) outputScore = Math.min(100, outputScore + questsCompleted * 10);

  // ── Weighted composite score ──────────────────────────────────────────
  const components = {
    sleep: Math.round(sleepScore),
    hrv: Math.round(hrvScore),
    energy: Math.round(energyScore),
    tasks: Math.round(taskScore),
    habits: Math.round(habitScore),
    output: Math.round(outputScore),
  };

  const weights = { sleep: 0.25, hrv: 0.15, energy: 0.20, tasks: 0.15, habits: 0.15, output: 0.10 };
  const score = Math.round(
    components.sleep * weights.sleep +
    components.hrv * weights.hrv +
    components.energy * weights.energy +
    components.tasks * weights.tasks +
    components.habits * weights.habits +
    components.output * weights.output
  );

  // ── Trend calculation ──────────────────────────────────────────────────
  let trend = "stable";
  if (scoreHistory.length >= 3) {
    const recentAvg = scoreHistory.slice(0, 3).reduce((s: number, r: any) => s + r.score, 0) / 3;
    const olderAvg = scoreHistory.slice(3).reduce((s: number, r: any) => s + r.score, 0) / Math.max(1, scoreHistory.slice(3).length);
    if (recentAvg > olderAvg + 5) trend = "improving";
    else if (recentAvg < olderAvg - 5) trend = "declining";
  }

  // ── Optimal window from behavioral patterns ───────────────────────────
  const peakHours: number[] = behavior.peak_hours ?? [];
  let optimal_window = "9am–11am"; // sensible default
  if (peakHours.length >= 2) {
    const sorted = [...peakHours].sort((a, b) => a - b);
    const startH = sorted[0];
    const endH = sorted[sorted.length - 1];
    const fmt = (h: number) => h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
    optimal_window = `${fmt(startH)}–${fmt(Math.min(endH + 1, 23))}`;
  }

  // ── AI recommendation ─────────────────────────────────────────────────
  const trendArrow = trend === "improving" ? "↑" : trend === "declining" ? "↓" : "→";
  let recommendation = `Performance score ${score}/100 ${trendArrow}. Focus on your peak window: ${optimal_window}.`;

  if (ANTHROPIC_KEY) {
    const rec = await callClaude(
      "You are a performance coach. Generate a single, specific, actionable recommendation for today based on the operator's performance data. 1-2 sentences max. Be direct and specific — no generic advice.",
      `Score: ${score}/100 (${trend}). Components: sleep ${components.sleep}, energy ${components.energy}, tasks ${components.tasks}, habits ${components.habits}. Peak window: ${optimal_window}. Wearable HRV: ${components.hrv}.`,
      150,
    );
    if (rec.trim()) recommendation = rec.trim();
  }

  return {
    score,
    components,
    optimal_window,
    trend,
    recommendation,
    raw_data: {
      sleep_metrics_count: sleepMetrics.length,
      hrv_latest: hrvMetrics[0]?.value ?? null,
      energy_pct: energy ? Math.round(energy.current_energy / Math.max(1, energy.max_energy) * 100) : null,
      tasks_completed: completedToday,
      tasks_total: totalTasks,
      habits_count: habits.length,
      revenue_yesterday: revenueYesterday,
      quests_completed_7d: questsCompleted,
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const today = new Date().toISOString().slice(0, 10);

    // GET: fetch score for a user
    if (req.method === "GET") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "user_id required" }, 400);
      const { data } = await sb.from("mavis_daily_scores").select("*").eq("user_id", userId).eq("score_date", today).maybeSingle();
      if (data) return json(data);
      return json({ score: null, message: "No score for today yet. Score generated daily at 7am." });
    }

    // POST cron fan-out: compute for all active users
    if (body.cron === true) {
      const { data: users } = await sb.from("profiles").select("id").limit(200);
      if (!users?.length) return json({ computed: 0 });

      let computed = 0;
      for (const { id: userId } of users) {
        try {
          const result = await computeScore(userId);
          await sb.from("mavis_daily_scores").upsert({
            user_id: userId,
            score_date: today,
            ...result,
          }, { onConflict: "user_id,score_date" });
          computed++;
        } catch { /* per-user error — continue */ }
      }
      return json({ computed, date: today });
    }

    // POST on-demand for a single user
    const userId = String(body.user_id ?? "");
    if (!userId) return json({ error: "user_id required" }, 400);

    const result = await computeScore(userId);
    await sb.from("mavis_daily_scores").upsert({
      user_id: userId,
      score_date: today,
      ...result,
    }, { onConflict: "user_id,score_date" });

    return json({ score_date: today, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[performance-science]", msg);
    return json({ error: msg }, 500);
  }
});
