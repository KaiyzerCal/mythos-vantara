// mavis-world-model
// Synthesizes all operator data streams into a coherent world state model.
// Runs weekly on Sunday at 5am via pg_cron.
// Also callable on-demand: POST { user_id } or GET ?user_id=...&action=latest
// verify_jwt = false (cron + service-role triggers)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function buildWorldModel(userId: string): Promise<{
  summary: string; trajectory: string; key_insights: string[];
  domains: Record<string, any>; opportunities: string[]; risks: string[];
}> {
  const [
    questsRes, tasksRes, memoriesRes, healthRes, financeRes,
    predictionsRes, entityCountRes, journalRes
  ] = await Promise.all([
    sb().from("quests").select("title,status,progress_current,progress_target,deadline").eq("user_id", userId).limit(20),
    sb().from("tasks").select("title,status,streak,type").eq("user_id", userId).eq("type","habit").limit(20),
    sb().from("mavis_memory").select("content,importance_score,created_at").eq("user_id", userId).order("importance_score", { ascending: false }).limit(30),
    sb().from("health_metrics").select("metric_type,value,recorded_at").eq("user_id", userId).order("recorded_at", { ascending: false }).limit(20),
    sb().from("mavis_revenue").select("amount,source,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    sb().from("mavis_predictions").select("prediction_type,title,confidence").eq("user_id", userId).eq("acted_on", false).limit(5),
    sb().from("mavis_entities").select("entity_type", { count: "exact" }).eq("user_id", userId),
    sb().from("journal_entries").select("content,mood,importance").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
  ]);

  const quests = questsRes.data ?? [];
  const habits = tasksRes.data ?? [];
  const memories = memoriesRes.data ?? [];
  const health = healthRes.data ?? [];
  const finance = financeRes.data ?? [];
  const predictions = predictionsRes.data ?? [];
  const entityCount = entityCountRes.count ?? 0;
  const journals = journalRes.data ?? [];

  // Domain scoring
  const activeQuests = quests.filter((q: any) => q.status === "active").length;
  const completedQuests = quests.filter((q: any) => q.status === "completed").length;
  const questScore = quests.length ? Math.round((completedQuests / Math.max(quests.length, 1)) * 100) : 0;
  const activeHabits = habits.filter((h: any) => (h.streak ?? 0) > 0).length;
  const habitScore = habits.length ? Math.round((activeHabits / Math.max(habits.length, 1)) * 100) : 50;
  const revenueTotal = finance.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const avgMood = journals.length ? journals.reduce((s: number, j: any) => s + Number(j.mood ?? 5), 0) / journals.length : 5;

  const domains = {
    goals: { score: questScore, active: activeQuests, completed: completedQuests },
    habits: { score: habitScore, active: activeHabits, total: habits.length },
    finance: { recent_revenue: revenueTotal, transactions: finance.length },
    health: { data_points: health.length, avg_mood: Math.round(avgMood * 10) / 10 },
    knowledge: { entity_count: entityCount, high_importance_memories: memories.filter((m: any) => (m.importance_score ?? 0) >= 7).length },
  };

  if (!ANTHROPIC_KEY) {
    return {
      summary: `You have ${activeQuests} active quests, ${activeHabits}/${habits.length} habits on streak, and $${revenueTotal.toFixed(0)} recent revenue.`,
      trajectory: "World model synthesis requires ANTHROPIC_API_KEY.",
      key_insights: predictions.map((p: any) => p.title),
      domains,
      opportunities: [],
      risks: [],
    };
  }

  const dataContext = [
    `QUESTS: ${activeQuests} active, ${completedQuests} completed out of ${quests.length} total`,
    `HABITS: ${activeHabits} active streaks out of ${habits.length} habits`,
    `TOP MEMORIES: ${memories.slice(0, 5).map((m: any) => m.content.slice(0, 100)).join(" | ")}`,
    `HEALTH DATA POINTS: ${health.length} recent metrics`,
    `RECENT REVENUE: $${revenueTotal.toFixed(0)} across ${finance.length} transactions`,
    `ACTIVE PREDICTIONS: ${predictions.map((p: any) => p.title).join(", ")}`,
    `KNOWLEDGE GRAPH: ${entityCount} tracked entities`,
    `RECENT JOURNAL MOODS: avg ${avgMood.toFixed(1)}/10`,
  ].join("\n");

  const prompt = `You are MAVIS building a comprehensive world model for your operator. Analyze this data and generate a strategic snapshot.

DATA:
${dataContext}

Return JSON with exactly this structure:
{
  "summary": "2-3 sentence present-tense summary of where the operator currently stands across all domains",
  "trajectory": "2-3 sentence projection of where they're headed if current trajectory continues",
  "key_insights": ["insight 1", "insight 2", "insight 3"],
  "opportunities": ["opportunity 1", "opportunity 2"],
  "risks": ["risk 1", "risk 2"]
}

Be specific, direct, and forward-looking. Avoid generic statements. Return ONLY valid JSON.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Claude error: ${res.status}`);
    const d = await res.json();
    const text = d.content?.find((b: any) => b.type === "text")?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: String(parsed.summary ?? ""),
      trajectory: String(parsed.trajectory ?? ""),
      key_insights: Array.isArray(parsed.key_insights) ? parsed.key_insights.map(String) : [],
      domains,
      opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.map(String) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    };
  } catch {
    return {
      summary: `You have ${activeQuests} active quests and ${activeHabits} habit streaks running. Revenue: $${revenueTotal.toFixed(0)}.`,
      trajectory: "Trajectory analysis requires Claude API.",
      key_insights: [],
      domains,
      opportunities: [],
      risks: [],
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any = {};
  try { if (req.method === "POST") body = await req.json().catch(() => ({})); } catch { /**/ }

  const isCron = Boolean(body?.cron);
  const url = new URL(req.url);

  // GET: return latest world model for a user
  if (req.method === "GET") {
    const userId = url.searchParams.get("user_id");
    if (!userId) return json({ error: "user_id required" }, 400);
    const { data } = await sb().from("mavis_world_model").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return json({ world_model: data });
  }

  let targetUserId: string | null = null;
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  if (isCron || token === SB_KEY) {
    targetUserId = body.user_id ?? null;
  } else {
    const { data: { user } } = await createClient(SB_URL, SB_KEY).auth.getUser(token);
    targetUserId = user?.id ?? null;
  }

  try {
    if (isCron) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: activeUsers } = await sb().from("mavis_memory").select("user_id").gte("created_at", cutoff).limit(100);
      const uniqueUsers = [...new Set((activeUsers ?? []).map((r: any) => r.user_id as string))];
      let processed = 0;
      for (const uid of uniqueUsers) {
        try {
          const model = await buildWorldModel(uid);
          await sb().from("mavis_world_model").insert({ user_id: uid, ...model });
          processed++;
        } catch (err: any) { console.error(`[world-model] ${uid}:`, err.message); }
      }
      return json({ users_processed: processed });
    }

    if (!targetUserId) return json({ error: "Unauthorized" }, 401);
    const model = await buildWorldModel(targetUserId);
    await sb().from("mavis_world_model").insert({ user_id: targetUserId, ...model });
    return json({ success: true, world_model: model });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[world-model]", msg);
    return json({ error: msg }, 500);
  }
});
