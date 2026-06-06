// mavis-causal-engine
// Discovers causal patterns in the operator's life data — what actually drives what.
// "Sleep quality predicts task completion 1-2 days later."
// "Quest completion streaks precede revenue peaks by 3 days."
// Runs weekly Sunday 2am. verify_jwt = false (cron + service-role).

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

async function callClaude(system: string, user: string): Promise<string> {
  if (!ANTHROPIC_KEY) return "[]";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      thinking: { type: "enabled", budget_tokens: 2000 },
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) return "[]";
  const d = await res.json();
  return d.content?.find((b: any) => b.type === "text")?.text ?? "[]";
}

function buildTimeSeries(
  days: number,
  healthMetrics: any[],
  tasks: any[],
  revenue: any[],
  journals: any[],
  rituals: any[],
): Array<{ date: string; sleep: number | null; energy: number | null; tasks_done: number; revenue: number; journaled: boolean; rituals_done: number }> {
  const series = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    const dayHealth = healthMetrics.filter((h: any) => h.recorded_at?.startsWith(dateStr));
    const sleepMetric = dayHealth.find((h: any) => ["sleep_score", "sleep_quality", "sleep_duration"].includes(h.metric_type));
    let sleep: number | null = null;
    if (sleepMetric) {
      sleep = sleepMetric.metric_type === "sleep_duration"
        ? Math.min(100, (Number(sleepMetric.value) / 3600 / 8) * 100) // normalize 8h = 100
        : Number(sleepMetric.value);
    }

    const energyMetric = dayHealth.find((h: any) => h.metric_type === "energy_level");
    const energy = energyMetric ? Number(energyMetric.value) : null;

    const dayTasks = tasks.filter((t: any) => t.completed_at?.startsWith(dateStr));
    const dayRevenue = revenue.filter((r: any) => r.created_at?.startsWith(dateStr));
    const dayJournals = journals.filter((j: any) => j.created_at?.startsWith(dateStr));
    const dayRituals = rituals.filter((r: any) => r.completed_at?.startsWith(dateStr));

    series.push({
      date: dateStr,
      sleep,
      energy,
      tasks_done: dayTasks.length,
      revenue: dayRevenue.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0),
      journaled: dayJournals.length > 0,
      rituals_done: dayRituals.length,
    });
  }
  return series;
}

async function analyzeUser(userId: string): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  const [healthRes, tasksRes, revenueRes, journalRes, ritualsRes] = await Promise.all([
    sb.from("health_metrics").select("metric_type,value,recorded_at").eq("user_id", userId).gte("recorded_at", ninetyDaysAgo).order("recorded_at", { ascending: true }),
    sb.from("tasks").select("completed_at,type,status").eq("user_id", userId).eq("status", "completed").gte("completed_at", ninetyDaysAgo),
    sb.from("mavis_revenue").select("amount,created_at").eq("user_id", userId).gte("created_at", ninetyDaysAgo),
    sb.from("journal_entries").select("created_at").eq("user_id", userId).gte("created_at", ninetyDaysAgo),
    sb.from("rituals").select("completed_at").eq("user_id", userId).gte("updated_at", ninetyDaysAgo).eq("completed", true),
  ]);

  const series = buildTimeSeries(
    90,
    healthRes.data ?? [],
    tasksRes.data ?? [],
    revenueRes.data ?? [],
    journalRes.data ?? [],
    ritualsRes.data ?? [],
  );

  // Summarize the time series compactly for Claude
  const seriesSummary = series.map(d =>
    `${d.date}: sleep=${d.sleep ?? "?"}%, energy=${d.energy ?? "?"}%, tasks=${d.tasks_done}, revenue=$${d.revenue.toFixed(0)}, journaled=${d.journaled ? "Y" : "N"}, rituals=${d.rituals_done}`
  ).join("\n");

  const dataQuality = {
    has_sleep: series.filter(d => d.sleep !== null).length,
    has_energy: series.filter(d => d.energy !== null).length,
    total_tasks: series.reduce((s, d) => s + d.tasks_done, 0),
    total_revenue: series.reduce((s, d) => s + d.revenue, 0),
    journal_days: series.filter(d => d.journaled).length,
  };

  if (dataQuality.total_tasks < 5 && dataQuality.has_sleep < 10) {
    return 0; // Not enough data for meaningful analysis
  }

  const rawText = await callClaude(
    `You are MAVIS's causal intelligence system. Analyze 90 days of operator life data and discover genuine causal relationships — what actually CAUSES other things, with what lag.

Look for patterns like:
- Input variables (sleep, energy, journaling, rituals) → Output variables (task completion, revenue)
- Leading indicators → lagging outcomes
- Negative patterns (what causes performance drops)

Return ONLY a JSON array of 3-5 causal chains. Each chain must have:
{
  "cause": "What the driving factor is (e.g., 'sleep score above 80%')",
  "effect": "What the outcome is (e.g., 'task completion increases by ~40%')",
  "lag_days": 0-7 (how many days later the effect appears),
  "correlation": -1 to 1 (strength and direction of relationship),
  "confidence": 0 to 1 (how confident based on data volume),
  "sample_size": number of data points,
  "description": "One clear sentence explaining this finding in plain English",
  "action_implication": "What the operator should specifically do differently based on this finding"
}

Only include chains where you see actual signal in the data. Be specific and honest about confidence. If data is sparse, set confidence < 0.5.`,
    `DATA QUALITY: ${JSON.stringify(dataQuality)}\n\n90-DAY TIME SERIES:\n${seriesSummary}`,
  );

  // Parse the JSON response
  let chains: any[] = [];
  try {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (jsonMatch) chains = JSON.parse(jsonMatch[0]);
  } catch { return 0; }

  if (!chains.length) return 0;

  const weekOf = new Date().toISOString().slice(0, 10);

  // Delete old chains for this user from this week
  await sb.from("mavis_causal_chains").delete().eq("user_id", userId).eq("week_of", weekOf);

  // Insert new chains
  const toInsert = chains.slice(0, 5).map((chain: any) => ({
    user_id: userId,
    cause: String(chain.cause ?? "").slice(0, 200),
    effect: String(chain.effect ?? "").slice(0, 200),
    lag_days: Math.max(0, Math.min(30, Number(chain.lag_days ?? 0))),
    correlation: Math.max(-1, Math.min(1, Number(chain.correlation ?? 0))),
    confidence: Math.max(0, Math.min(1, Number(chain.confidence ?? 0.5))),
    sample_size: Math.max(0, Number(chain.sample_size ?? 0)),
    description: String(chain.description ?? "").slice(0, 500),
    action_implication: chain.action_implication ? String(chain.action_implication).slice(0, 300) : null,
    week_of: weekOf,
  }));

  const { error } = await sb.from("mavis_causal_chains").insert(toInsert);
  if (error) console.error("[causal-engine]", error.message);

  return toInsert.length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // GET: fetch causal chains for a user
    if (req.method === "GET") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "user_id required" }, 400);
      const { data } = await sb.from("mavis_causal_chains").select("*").eq("user_id", userId).order("confidence", { ascending: false }).limit(10);
      return json({ chains: data ?? [] });
    }

    // POST cron: fan-out across all users
    if (body.cron === true) {
      const { data: users } = await sb.from("profiles").select("id").limit(100);
      if (!users?.length) return json({ analyzed: 0 });
      let analyzed = 0;
      for (const { id } of users) {
        try { const n = await analyzeUser(id); if (n > 0) analyzed++; } catch { /* continue */ }
      }
      return json({ analyzed, week_of: new Date().toISOString().slice(0, 10) });
    }

    // POST on-demand for single user
    const userId = String(body.user_id ?? "");
    if (!userId) return json({ error: "user_id required" }, 400);
    const count = await analyzeUser(userId);
    const { data: chains } = await sb.from("mavis_causal_chains").select("*").eq("user_id", userId).order("confidence", { ascending: false }).limit(5);
    return json({ chains_discovered: count, chains: chains ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[causal-engine]", msg);
    return json({ error: msg }, 500);
  }
});
