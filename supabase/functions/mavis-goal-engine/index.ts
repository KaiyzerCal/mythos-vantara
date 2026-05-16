// MAVIS Goal Decomposition Engine
// Takes a high-level objective and decomposes it into 3-5 concrete quests.
// Called by mavis-actions when a `goal` action fires.
// Stores goal in mavis_goals, creates quests, notifies via Telegram.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID       = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const LOVABLE_KEY   = Deno.env.get("LOVABLE_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

async function callAI(system: string, userMsg: string): Promise<string> {
  if (LOVABLE_KEY) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
          max_tokens: 1000,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const t = d.choices?.[0]?.message?.content ?? "";
        if (t) return t;
      }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", max_tokens: 1000, system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (res.ok) { const d = await res.json(); return d.content?.[0]?.text ?? ""; }
  }
  if (OPENAI_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
        max_tokens: 1000,
      }),
    });
    if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content ?? ""; }
  }
  throw new Error("No AI provider available");
}

function parseQuests(text: string): any[] {
  const match = text.match(/\{[\s\S]*"quests"[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.quests) ? parsed.quests : [];
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }

    const { goal_id, objective, context, user_id } = body;
    if (!objective || !user_id) {
      return new Response(JSON.stringify({ error: "objective and user_id required" }), { status: 400 });
    }

    // Load brief operator context for smarter decomposition
    const [profileRes, activeQuestsRes] = await Promise.all([
      supabase.from("profiles").select("display_name, level, xp").eq("id", user_id).single(),
      supabase.from("quests").select("title").eq("user_id", user_id).eq("status", "active").limit(5),
    ]);
    const profile       = profileRes.data as any;
    const activeQuests  = (activeQuestsRes.data ?? []) as any[];

    const contextBlock = [
      profile ? `Operator: ${profile.display_name ?? "Calvin"}, Level ${profile.level ?? "?"}, XP ${profile.xp ?? 0}` : "",
      activeQuests.length > 0 ? `Already active: ${activeQuests.map((q: any) => q.title).join(", ")}` : "",
      context ? `Additional context: ${context}` : "",
    ].filter(Boolean).join("\n");

    // Decompose via AI
    const systemPrompt = `You are MAVIS, Calvin's AI. Decompose a high-level goal into 3-5 concrete, achievable quests.

Each quest must be:
- Specific and actionable with a clear deliverable
- Completable within 1-7 days
- Not duplicating existing active quests
- Directly contributing to the goal

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "quests": [
    {
      "title": "Short action-oriented title",
      "description": "What exactly needs to happen",
      "type": "side|main|daily",
      "difficulty": "Easy|Normal|Hard|Extreme",
      "xp_reward": 100,
      "category": "business|fitness|learning|finance|creative|personal"
    }
  ]
}`;

    const userMsg = `Goal: ${objective}\n\n${contextBlock}`;
    const aiResponse = await callAI(systemPrompt, userMsg);
    const quests = parseQuests(aiResponse);

    if (!quests.length) throw new Error("AI returned no quests — try rephrasing the goal");

    // Create the quests
    const createdIds: string[] = [];
    for (const q of quests.slice(0, 5)) {
      const { data: created, error } = await supabase.from("quests").insert({
        user_id:          user_id,
        title:            String(q.title ?? "Quest"),
        description:      String(q.description ?? ""),
        type:             String(q.type ?? "side"),
        status:           "active",
        difficulty:       String(q.difficulty ?? "Normal"),
        xp_reward:        Number(q.xp_reward ?? 100),
        category:         q.category ? String(q.category) : null,
        real_world_mapping: `Goal: ${objective.slice(0, 100)}`,
        progress_current: 0,
        progress_target:  1,
        loot_rewards:     [],
        linked_skill_ids: [],
      }).select("id").single();
      if (!error && created?.id) createdIds.push(created.id);
    }

    // Update goal record if goal_id provided
    if (goal_id) {
      await supabase.from("mavis_goals").update({
        decomposed:  true,
        quest_ids:   createdIds,
        updated_at:  new Date().toISOString(),
      }).eq("id", goal_id);
    }

    // Telegram notification
    if (BOT_TOKEN && CHAT_ID && createdIds.length > 0) {
      const questLines = quests.slice(0, createdIds.length).map((q: any, i: number) =>
        `${i + 1}. ${q.title} [${q.difficulty ?? "Normal"}]`
      ).join("\n");
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: `GOAL DECOMPOSED\nObjective: ${objective.slice(0, 100)}\n\n${questLines}\n\n${createdIds.length} quest${createdIds.length !== 1 ? "s" : ""} added to active board.`,
        }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({ ok: true, goal_id, quests_created: createdIds.length, quest_ids: createdIds }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-goal-engine]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
