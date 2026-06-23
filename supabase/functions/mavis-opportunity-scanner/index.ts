// mavis-opportunity-scanner
// Scans all data streams for non-obvious cross-domain opportunities.
// Runs daily at 7am. Returns opportunities the operator hasn't noticed.
// verify_jwt = false

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

async function tgSend(chatId: string, text: string): Promise<void> {
  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!BOT_TOKEN || !chatId) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function scanOpportunities(userId: string): Promise<number> {
  const [
    questsRes, skillsRes, habitsRes, memoriesRes, entitiesRes,
    behaviorRes, healthRes, financeRes
  ] = await Promise.all([
    sb().from("quests").select("title,description,status,type").eq("user_id", userId).limit(20),
    sb().from("skills").select("name,category,proficiency,tier").eq("user_id", userId).limit(30),
    sb().from("tasks").select("title,type,streak,status").eq("user_id", userId).eq("type","habit").limit(20),
    sb().from("mavis_memory").select("content,importance_score").eq("user_id", userId).order("importance_score", { ascending: false }).limit(25),
    sb().from("mavis_entities").select("name,entity_type,description,mention_count").eq("user_id", userId).order("mention_count", { ascending: false }).limit(20),
    sb().from("mavis_behavioral_patterns").select("pattern_data").eq("user_id", userId).eq("pattern_type","interaction_analysis").maybeSingle(),
    sb().from("health_metrics").select("metric_type,value,recorded_at").eq("user_id", userId).order("recorded_at", { ascending: false }).limit(15),
    sb().from("mavis_revenue").select("amount,source,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
  ]);

  if (!ANTHROPIC_KEY) return 0;

  const quests = questsRes.data ?? [];
  const skills = skillsRes.data ?? [];
  const habits = habitsRes.data ?? [];
  const memories = memoriesRes.data ?? [];
  const entities = entitiesRes.data ?? [];
  const behavior = (behaviorRes.data as any)?.pattern_data ?? {};
  const health = healthRes.data ?? [];
  const finance = financeRes.data ?? [];

  const peakHours = behavior.peak_hours ?? [];
  const topTopics = behavior.top_topics ?? [];
  const revenueTotal = finance.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

  const dataContext = `
OPERATOR PROFILE:
- Active quests: ${quests.filter((q: any) => q.status === "active").map((q: any) => q.title).join(", ")}
- Skills: ${skills.slice(0, 10).map((s: any) => `${s.name}(${s.category},${s.proficiency}%)`).join(", ")}
- Active habits: ${habits.filter((h: any) => h.streak > 0).map((h: any) => `${h.title}(${h.streak}d streak)`).join(", ")}
- Peak productivity hours: ${peakHours.map((h: number) => `${h}:00`).join(", ")}
- Top topics: ${topTopics.slice(0, 6).map((t: any) => Array.isArray(t) ? t[0] : t).join(", ")}
- Key entities: ${entities.filter((e: any) => ["person","company","project"].includes(e.entity_type)).slice(0, 8).map((e: any) => `${e.name}(${e.entity_type})`).join(", ")}
- Health data points: ${health.length}
- Recent revenue: $${revenueTotal.toFixed(0)}
- Top memories: ${memories.slice(0, 6).map((m: any) => m.content.slice(0, 80)).join(" | ")}`;

  const prompt = `You are MAVIS's Opportunity Scanner — your job is to find cross-domain opportunities the operator hasn't explicitly noticed or acted on.

Look for:
- Skills that map to current goals but aren't being applied
- Timing windows based on peak hours vs. how time is actually allocated
- Dormant relationships (entities mentioned but not recently engaged)
- Cross-domain synergies (e.g., a habit that could fuel a business goal)
- Financial patterns with optimization potential
- Behavioral patterns with performance implications

DATA:
${dataContext}

Generate 3-5 specific, non-obvious opportunities as JSON array:
[
  {
    "title": "Short title",
    "description": "Specific description of the opportunity (2-3 sentences)",
    "opportunity_type": "skill_gap_bridge|timing_window|dormant_asset|cross_domain_synergy|pattern_leverage|relationship_leverage|financial_optimization|health_performance",
    "domains": ["domain1", "domain2"],
    "potential_value": "Concrete potential value or outcome",
    "action_steps": ["step 1", "step 2", "step 3"],
    "confidence": 0.0-1.0
  }
]

Be SPECIFIC. Not "improve your habits" but "Your coding skill is at 85% proficiency but your 'Build SaaS' quest doesn't have any code-related tasks — create 3 technical milestones." Return ONLY valid JSON array.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return 0;
    const d = await res.json();
    const text = d.content?.find((b: any) => b.type === "text")?.text ?? "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return 0;
    const opportunities = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(opportunities) || opportunities.length === 0) return 0;

    // Expire old opportunities
    await sb().from("mavis_opportunities").update({ acted_on: true })
      .eq("user_id", userId).eq("acted_on", false)
      .lt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const validTypes = ["skill_gap_bridge","timing_window","dormant_asset","cross_domain_synergy","pattern_leverage","relationship_leverage","financial_optimization","health_performance"];
    const toInsert = opportunities
      .filter((o: any) => validTypes.includes(o.opportunity_type) && o.title && o.description)
      .map((o: any) => ({
        user_id: userId,
        title: String(o.title).slice(0, 200),
        description: String(o.description).slice(0, 1000),
        opportunity_type: String(o.opportunity_type),
        domains: Array.isArray(o.domains) ? o.domains.map(String) : [],
        potential_value: String(o.potential_value ?? "").slice(0, 300),
        action_steps: Array.isArray(o.action_steps) ? o.action_steps : [],
        confidence: Math.min(1, Math.max(0, Number(o.confidence ?? 0.7))),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }));

    if (toInsert.length > 0) {
      await sb().from("mavis_opportunities").insert(toInsert);
    }

    // ── World model cross-reference ──────────────────────────────────────────
    const { data: worldModelRow } = await sb()
      .from("mavis_world_model")
      .select("opportunities")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .maybeSingle();

    const existingOppTitles: string[] = (
      (worldModelRow as any)?.opportunities ?? []
    ).map((o: any) => String(o.title ?? "").toLowerCase().trim());

    const netNewOpportunities = toInsert.filter(
      (o) => !existingOppTitles.some(
        (existing) => existing === o.title.toLowerCase().trim()
      )
    );

    if (netNewOpportunities.length === 0) return toInsert.length;

    // ── Strategic scoring via Claude Haiku ──────────────────────────────────
    const activeGoalTitles = quests
      .filter((q: any) => q.status === "active")
      .map((q: any) => q.title)
      .join(", ");

    const topSkillNames = skills
      .slice(0, 8)
      .map((s: any) => `${s.name}(${s.proficiency}%)`)
      .join(", ");

    const scoringPrompt = `You are a strategic advisor. Score each opportunity on three dimensions (1–10 each):
1. goal_alignment – how well it aligns with the operator's active goals
2. feasibility – how achievable it is given current skills and resources
3. time_sensitivity – how urgent or time-limited the window is

Active goals: ${activeGoalTitles || "none"}
Top skills: ${topSkillNames || "none"}

Opportunities to score:
${netNewOpportunities.map((o, i) => `${i + 1}. ${o.title}: ${o.description}`).join("\n")}

Return a JSON array in the same order, one object per opportunity:
[{"goal_alignment":7,"feasibility":8,"time_sensitivity":5}, ...]
Return ONLY valid JSON array, no commentary.`;

    let scoredOpportunities = netNewOpportunities.map((o) => ({ ...o, avgScore: 7 }));

    try {
      const scoreRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 512,
          messages: [{ role: "user", content: scoringPrompt }],
        }),
      });

      if (scoreRes.ok) {
        const scoreData = await scoreRes.json();
        const scoreText = scoreData.content?.find((b: any) => b.type === "text")?.text ?? "[]";
        const scoreMatch = scoreText.match(/\[[\s\S]*\]/);
        if (scoreMatch) {
          const scores: Array<{ goal_alignment: number; feasibility: number; time_sensitivity: number }> =
            JSON.parse(scoreMatch[0]);
          scoredOpportunities = netNewOpportunities.map((o, i) => {
            const s = scores[i];
            const avg = s
              ? (Number(s.goal_alignment) + Number(s.feasibility) + Number(s.time_sensitivity)) / 3
              : 7;
            return { ...o, avgScore: avg, scores: s };
          });
        }
      }
    } catch { /* keep default scores */ }

    // Keep only opportunities averaging >= 6
    const qualifiedOpportunities = scoredOpportunities.filter((o) => o.avgScore >= 6);
    if (qualifiedOpportunities.length === 0) return toInsert.length;

    // Top 3 by average score
    const top3 = qualifiedOpportunities
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 3);

    // ── Telegram delivery ────────────────────────────────────────────────────
    const { data: profile } = await sb()
      .from("profiles")
      .select("telegram_chat_id")
      .eq("id", userId)
      .maybeSingle();
    const chatId = (profile as any)?.telegram_chat_id;

    const oppLines = top3
      .map((o, i) => {
        const scoreDisplay = Math.round(o.avgScore);
        const timeReason = (o as any).scores?.time_sensitivity >= 7
          ? "Window is closing — act this week."
          : "Steady window, but momentum favors early movers.";
        return `<b>${i + 1}. ${o.title}</b>\n${o.description}\nWhy now: ${timeReason}\nScore: ${scoreDisplay}/10`;
      })
      .join("\n\n");

    const telegramMessage = `🎯 <b>MAVIS Weekly Opportunity Brief</b>\n\nHere's what I see that you haven't moved on yet:\n\n${oppLines}\n\nReply to act on any of these.`;

    if (chatId) {
      await tgSend(String(chatId), telegramMessage);
    }

    // ── Save brief to mavis_memory ───────────────────────────────────────────
    const memoryContent = `Weekly Opportunity Brief (${new Date().toISOString().slice(0, 10)}):\n${top3.map((o, i) => `${i + 1}. ${o.title} — ${o.description}`).join("\n")}`;

    await sb().from("mavis_memory").insert({
      user_id: userId,
      content: memoryContent,
      importance_score: 4,
      tags: ["opportunity", "proactive", "weekly-brief"],
      source: "mavis-opportunity-scanner",
    }).catch(() => {});

    return toInsert.length;
  } catch {
    return 0;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any = {};
  try { if (req.method === "POST") body = await req.json().catch(() => ({})); } catch { /**/ }
  const isCron = Boolean(body?.cron);

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
      let total = 0;
      for (const uid of uniqueUsers) {
        try { total += await scanOpportunities(uid); } catch { /**/ }
      }
      return json({ users_processed: uniqueUsers.length, opportunities_created: total });
    }
    if (!targetUserId) return json({ error: "Unauthorized" }, 401);
    const count = await scanOpportunities(targetUserId);

    const { data: opps } = await sb().from("mavis_opportunities").select("*").eq("user_id", targetUserId).eq("acted_on", false).order("confidence", { ascending: false }).limit(10);
    return json({ opportunities_created: count, opportunities: opps ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
