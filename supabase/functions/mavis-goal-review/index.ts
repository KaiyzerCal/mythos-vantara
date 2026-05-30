// MAVIS Goal Re-Evaluation
// Runs weekly (Mondays at 09:00 UTC). For each active goal:
//   - Counts completed quests vs total
//   - Marks goals complete when all quests done
//   - Spawns 1-2 replacement quests for stalled goals (>7 days, <50% done)
//   - Sends Telegram progress report

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPERATOR_USER_ID  = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const BOT_TOKEN         = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID           = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const ANTHROPIC_KEY     = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const LOVABLE_KEY       = Deno.env.get("LOVABLE_API_KEY") ?? "";
const OPENAI_KEY        = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

async function callAI(system: string, userMsg: string): Promise<string> {
  if (LOVABLE_KEY) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
          max_tokens: 600,
        }),
      });
      if (res.ok) { const d = await res.json(); const t = d.choices?.[0]?.message?.content ?? ""; if (t) return t; }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, system, messages: [{ role: "user", content: userMsg }] }),
    });
    if (res.ok) { const d = await res.json(); return d.content?.[0]?.text ?? ""; }
  }
  if (OPENAI_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: system }, { role: "user", content: userMsg }], max_tokens: 600 }),
    });
    if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content ?? ""; }
  }
  return "";
}

function parseQuests(text: string): any[] {
  const match = text.match(/\{[\s\S]*"quests"[\s\S]*\}/);
  if (!match) return [];
  try { const p = JSON.parse(match[0]); return Array.isArray(p.quests) ? p.quests : []; } catch { return []; }
}

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…" : text;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: payload }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    if (!OPERATOR_USER_ID) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");
    const uid = OPERATOR_USER_ID;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    // Load all active goals
    const { data: goals } = await supabase
      .from("mavis_goals")
      .select("id, objective, context, quest_ids, created_at, decomposed")
      .eq("user_id", uid)
      .eq("status", "active")
      .eq("decomposed", true);

    if (!goals?.length) {
      return new Response(JSON.stringify({ ok: true, message: "No active decomposed goals" }));
    }

    const report: string[] = ["GOAL REVIEW — Weekly Check-In\n"];
    let completed = 0;
    let spawned   = 0;

    for (const goal of goals as any[]) {
      const questIds = Array.isArray(goal.quest_ids) ? goal.quest_ids : [];
      if (!questIds.length) continue;

      const { data: quests } = await supabase
        .from("quests").select("id, title, status")
        .in("id", questIds);

      const all       = (quests ?? []) as any[];
      const done      = all.filter(q => q.status === "completed");
      const active    = all.filter(q => q.status === "active");
      const pct       = all.length > 0 ? Math.round((done.length / all.length) * 100) : 0;
      const isOld     = new Date(goal.created_at) < new Date(sevenDaysAgo);
      const isStalled = isOld && pct < 50 && active.length > 0;

      // Mark goal complete if all quests done
      if (done.length === all.length && all.length > 0) {
        await supabase.from("mavis_goals").update({ status: "completed", updated_at: now.toISOString() }).eq("id", goal.id);
        report.push(`✓ COMPLETED: ${goal.objective.slice(0, 70)}\n  All ${all.length} quests done.`);
        completed++;
        continue;
      }

      report.push(`◉ ${goal.objective.slice(0, 70)}\n  ${done.length}/${all.length} quests done (${pct}%)${isStalled ? " — STALLED" : ""}`);

      // Spawn replacement quests for stalled goals
      if (isStalled) {
        const completedTitles = done.map((q: any) => q.title).join(", ");
        const activeTitles    = active.map((q: any) => q.title).join(", ");

        const aiResponse = await callAI(
          `You are MAVIS. A goal is stalled — less than 50% of its quests are complete after 7+ days. Propose 1-2 fresh, more actionable quests to unblock it. Respond with ONLY valid JSON:
{"quests":[{"title":"...","description":"...","type":"side","difficulty":"Easy|Normal","xp_reward":75,"category":"..."}]}`,
          `Goal: ${goal.objective}\nCompleted quests: ${completedTitles || "none"}\nStill active: ${activeTitles}\nContext: ${goal.context || "none"}`
        );

        const newQuests = parseQuests(aiResponse);
        const newIds: string[] = [];
        for (const q of newQuests.slice(0, 2)) {
          const { data: created } = await supabase.from("quests").insert({
            user_id: uid, title: String(q.title ?? "Quest"), description: String(q.description ?? ""),
            type: String(q.type ?? "side"), status: "active", difficulty: String(q.difficulty ?? "Normal"),
            xp_reward: Number(q.xp_reward ?? 75), category: q.category ? String(q.category) : null,
            real_world_mapping: `Goal: ${goal.objective.slice(0, 100)}`,
            progress_current: 0, progress_target: 1, loot_rewards: [], linked_skill_ids: [],
          }).select("id").single();
          if (created?.id) newIds.push(created.id);
        }

        if (newIds.length > 0) {
          const allIds = [...questIds, ...newIds];
          await supabase.from("mavis_goals").update({ quest_ids: allIds, updated_at: now.toISOString() }).eq("id", goal.id);
          report.push(`  → Spawned ${newIds.length} new quest(s) to unblock.`);
          spawned += newIds.length;
        }
      }
    }

    const summary = `${goals.length} goal(s) reviewed · ${completed} completed · ${spawned} new quest(s) spawned`;
    report.push(`\n${summary}`);
    await sendTelegram(report.join("\n\n"));

    return new Response(
      JSON.stringify({ ok: true, goals_reviewed: goals.length, completed, quests_spawned: spawned }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-goal-review]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
