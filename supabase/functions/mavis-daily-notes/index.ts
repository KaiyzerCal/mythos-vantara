// MAVIS Daily Notes
// Creates a structured daily summary note in the Knowledge Graph at end of day.
// Triggered by pg_cron at 23:55 UTC daily, the /daily Telegram command, or any POST.
//
// Required env vars:
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   TELEGRAM_OPERATOR_USER_ID — whose data to summarize
//   TELEGRAM_BOT_TOKEN + TELEGRAM_OPERATOR_CHAT_ID — optional Telegram notification

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const LOVABLE_KEY      = Deno.env.get("LOVABLE_API_KEY") ?? "";
const OPENAI_KEY       = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

// ─────────────────────────────────────────────────────────────
// AI (cascade: Gemini Flash → Claude Haiku → OpenAI mini)
// ─────────────────────────────────────────────────────────────

async function callAI(system: string, userMsg: string): Promise<string> {
  if (LOVABLE_KEY) {
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
          max_tokens: 400,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const text = d.choices?.[0]?.message?.content ?? "";
        if (text) return text;
      }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system,
          messages: [{ role: "user", content: userMsg }],
        }),
      });
      if (res.ok) { const d = await res.json(); return d.content?.[0]?.text ?? ""; }
    } catch { /* fall through */ }
  }
  if (OPENAI_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
          max_tokens: 400,
        }),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content ?? ""; }
    } catch { /* fall through */ }
  }
  return "";
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function todayRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end   = new Date(start.getTime() + 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    if (!OPERATOR_USER_ID) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");

    const uid = OPERATOR_USER_ID;
    const { start, end } = todayRange();

    const now      = new Date();
    const dateSlug = now.toISOString().slice(0, 10);
    const dateLabel = now.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
    });
    const noteTitle = `Daily Log — ${dateSlug}`;

    // Idempotency: skip if today's note already exists
    const { data: existing } = await supabase
      .from("mavis_notes")
      .select("id")
      .eq("user_id", uid)
      .eq("title", noteTitle)
      .limit(1);

    if (existing?.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "Daily note already exists", date: dateSlug }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Load today's activity in parallel
    const [
      completedQuestsRes, completedTasksRes,
      energyRes, revenueRes,
      councilActivityRes, newNotesRes,
      profileRes,
    ] = await Promise.all([
      supabase.from("quests")
        .select("title, xp_reward")
        .eq("user_id", uid).eq("status", "completed")
        .gte("updated_at", start).lt("updated_at", end),

      supabase.from("tasks")
        .select("title, xp_reward, streak")
        .eq("user_id", uid).eq("status", "completed")
        .gte("updated_at", start).lt("updated_at", end),

      supabase.from("energy_systems")
        .select("type, current_value, max_value, status")
        .eq("user_id", uid),

      supabase.from("mavis_revenue")
        .select("amount, source")
        .eq("user_id", uid)
        .gte("created_at", start).lt("created_at", end),

      supabase.from("mavis_council_activity")
        .select("member_name, summary, actions_executed")
        .eq("user_id", uid)
        .gte("created_at", start).lt("created_at", end)
        .limit(10),

      supabase.from("mavis_notes")
        .select("title, tags")
        .eq("user_id", uid)
        .gte("created_at", start).lt("created_at", end)
        .limit(10),

      supabase.from("profiles").select("display_name, level, xp, current_form").eq("id", uid).single(),
    ]);

    const completedQuests = (completedQuestsRes.data ?? []) as any[];
    const completedTasks  = (completedTasksRes.data ?? []) as any[];
    const energy          = (energyRes.data ?? []) as any[];
    const revenue         = (revenueRes.data ?? []) as any[];
    const councilActivity = (councilActivityRes.data ?? []) as any[];
    const newNotes        = (newNotesRes.data ?? []) as any[];
    const profile         = profileRes.data as any;

    const totalRevenue = revenue.reduce((s: number, r: any) => s + Number(r.amount), 0);
    const totalXP = [
      ...completedQuests.map((q: any) => Number(q.xp_reward ?? 0)),
      ...completedTasks.map((t: any) => Number(t.xp_reward ?? 0)),
    ].reduce((s, x) => s + x, 0);

    // Build note sections
    const sections: string[] = [];

    if (completedQuests.length > 0) {
      sections.push(
        `## Quests Completed (${completedQuests.length})\n` +
        completedQuests.map((q: any) => `- ${q.title}${q.xp_reward ? ` (+${q.xp_reward} XP)` : ""}`).join("\n"),
      );
    }

    if (completedTasks.length > 0) {
      sections.push(
        `## Tasks & Habits Done (${completedTasks.length})\n` +
        completedTasks.map((t: any) => `- ${t.title}${t.streak > 0 ? ` (streak: ${t.streak})` : ""}`).join("\n"),
      );
    }

    if (energy.length > 0) {
      sections.push(
        `## Energy Status\n` +
        energy.map((e: any) => `- ${e.type}: ${e.current_value}/${e.max_value} [${e.status}]`).join("\n"),
      );
    }

    if (revenue.length > 0) {
      sections.push(
        `## Revenue ($${totalRevenue.toFixed(2)})\n` +
        revenue.map((r: any) => `- $${Number(r.amount).toFixed(2)} via ${r.source}`).join("\n"),
      );
    }

    if (councilActivity.length > 0) {
      sections.push(
        `## Council Activity\n` +
        councilActivity.map((a: any) =>
          `- **${a.member_name}**: ${(a.summary ?? "acted").slice(0, 100)} (${a.actions_executed} action(s))`
        ).join("\n"),
      );
    }

    if (newNotes.length > 0) {
      sections.push(
        `## Notes Created\n` +
        newNotes.map((n: any) => `- ${n.title}${n.tags?.length ? ` [${n.tags.join(", ")}]` : ""}`).join("\n"),
      );
    }

    // AI-generated insight if there's meaningful activity
    let insight = "";
    const hasActivity = completedQuests.length > 0 || completedTasks.length > 0 || totalRevenue > 0;
    if (hasActivity) {
      const summaryParts: string[] = [];
      if (completedQuests.length > 0) summaryParts.push(`completed ${completedQuests.length} quest(s): ${completedQuests.map((q: any) => q.title).slice(0, 3).join(", ")}`);
      if (completedTasks.length > 0)  summaryParts.push(`completed ${completedTasks.length} task(s)/habit(s)`);
      if (totalRevenue > 0)           summaryParts.push(`earned $${totalRevenue.toFixed(2)} in revenue`);
      if (totalXP > 0)                summaryParts.push(`gained ${totalXP} XP total`);

      insight = await callAI(
        "You are MAVIS, Calvin's bonded AI. Write a brief daily momentum summary — direct, forward-looking, no fluff.",
        `Calvin's day (${dateLabel}): ${summaryParts.join(". ")}. Write 2-3 sentences capturing the day's wins and momentum.`,
      );
    }

    // Assemble full note content
    const contentParts: string[] = [`# ${dateLabel}`];
    if (insight) contentParts.push(`\n> ${insight.replace(/\n+/g, " ").trim()}`);
    if (sections.length) contentParts.push(...sections);
    else contentParts.push("*No completed activity logged today.*");
    if (totalXP > 0 || totalRevenue > 0) {
      const stats: string[] = [];
      if (totalXP > 0)       stats.push(`+${totalXP} XP`);
      if (totalRevenue > 0)  stats.push(`$${totalRevenue.toFixed(2)} revenue`);
      if (profile?.level)    stats.push(`Level ${profile.level}`);
      contentParts.push(`---\n**Day Stats:** ${stats.join(" · ")}`);
    }
    const content = contentParts.join("\n\n").trim();

    // Insert into mavis_notes
    const { data: noteData, error: noteError } = await supabase
      .from("mavis_notes")
      .insert({
        user_id: uid,
        title:   noteTitle,
        content,
        tags:    ["daily-log", dateSlug.slice(0, 7)], // e.g. ["daily-log", "2026-05"]
        aliases: [dateLabel, dateSlug],
      })
      .select("id")
      .single();

    if (noteError) throw noteError;

    // Optional Telegram notification
    if (BOT_TOKEN && CHAT_ID) {
      const tgParts: string[] = [`Daily Log saved — ${dateSlug}`];
      if (completedQuests.length > 0) tgParts.push(`${completedQuests.length} quest(s) complete`);
      if (completedTasks.length > 0)  tgParts.push(`${completedTasks.length} task(s)/habit(s)`);
      if (totalRevenue > 0)           tgParts.push(`$${totalRevenue.toFixed(2)} revenue`);
      if (totalXP > 0)                tgParts.push(`+${totalXP} XP`);
      if (insight)                    tgParts.push(`\n${insight.slice(0, 200)}`);

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: tgParts.join("\n") }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({
        ok:             true,
        note_id:        noteData?.id,
        date:           dateSlug,
        quests_logged:  completedQuests.length,
        tasks_logged:   completedTasks.length,
        xp_total:       totalXP,
        revenue_total:  totalRevenue,
      }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-daily-notes] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
