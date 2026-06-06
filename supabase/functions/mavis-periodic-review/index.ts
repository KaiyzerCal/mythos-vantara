// MAVIS Periodic Review
// Aggregates daily log notes into weekly (Sunday) and monthly (last day) summaries.
// Creates a structured review note in the Knowledge Graph + Telegram notification.
// Triggered by pg_cron or /weekly / /monthly Telegram commands.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const LOVABLE_KEY      = Deno.env.get("LOVABLE_API_KEY") ?? "";
const OPENAI_KEY       = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

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
      if (res.ok) {
        const d = await res.json();
        const t = d.choices?.[0]?.message?.content ?? "";
        if (t) return t;
      }
    } catch { /* fall through */ }
  }
  if (ANTHROPIC_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001", max_tokens: 600, system,
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
          max_tokens: 600,
        }),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content ?? ""; }
    } catch { /* fall through */ }
  }
  return "";
}

function isoWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    if (!OPERATOR_USER_ID) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }

    const uid = OPERATOR_USER_ID;
    const now = new Date();

    // Determine review type — explicit or auto-detect
    let reviewType: "weekly" | "monthly" = body.type ?? "weekly";
    if (!body.type) {
      const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
      if (now.getUTCDate() === lastDay) reviewType = "monthly";
      else if (now.getUTCDay() === 0) reviewType = "weekly";
    }

    // Date range
    let rangeStart: Date;
    let rangeEnd: Date = now;
    let noteTitle: string;
    let reviewTag: string;
    let periodLabel: string;

    if (reviewType === "weekly") {
      const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
      rangeStart  = weekStart;
      const weekNum  = isoWeek(now);
      noteTitle   = `Weekly Review — ${now.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
      reviewTag   = "weekly-review";
      periodLabel = `Week ${weekNum}, ${now.getUTCFullYear()}`;
    } else {
      rangeStart  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthName = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      noteTitle   = `Monthly Review — ${now.toISOString().slice(0, 7)}`;
      reviewTag   = "monthly-review";
      periodLabel = monthName;
    }

    // Idempotency
    const { data: existing } = await supabase
      .from("mavis_notes").select("id").eq("user_id", uid).eq("title", noteTitle).limit(1);
    if (existing?.length) {
      return new Response(JSON.stringify({ ok: true, message: "Review already exists", title: noteTitle }));
    }

    const startIso = rangeStart.toISOString();

    // Load daily log notes from the period
    const { data: dailyNotes } = await supabase
      .from("mavis_notes")
      .select("title, content")
      .eq("user_id", uid)
      .ilike("title", "Daily Log — %")
      .gte("created_at", startIso)
      .order("created_at", { ascending: true });

    // Load completed quests, tasks, revenue from the period
    const [questsRes, tasksRes, revenueRes, councilRes] = await Promise.all([
      supabase.from("quests").select("title, xp_reward").eq("user_id", uid).eq("status", "completed").gte("updated_at", startIso),
      supabase.from("tasks").select("title, streak").eq("user_id", uid).gte("updated_at", startIso).eq("status", "completed"),
      supabase.from("mavis_revenue").select("amount, source").eq("user_id", uid).gte("created_at", startIso),
      supabase.from("mavis_council_activity").select("member_name, summary, actions_executed").eq("user_id", uid).gte("created_at", startIso).limit(20),
    ]);

    const quests  = (questsRes.data ?? []) as any[];
    const tasks   = (tasksRes.data ?? []) as any[];
    const revenue = (revenueRes.data ?? []) as any[];
    const council = (councilRes.data ?? []) as any[];
    const daily   = (dailyNotes ?? []) as any[];

    const totalRevenue = revenue.reduce((s: number, r: any) => s + Number(r.amount), 0);
    const totalXP      = quests.reduce((s: number, q: any) => s + Number(q.xp_reward ?? 0), 0);

    // Build sections
    const sections: string[] = [];

    if (daily.length > 0) {
      sections.push(`## Daily Logs This Period\n${daily.map((n: any) => `- ${n.title}`).join("\n")}`);
    }

    if (quests.length > 0) {
      sections.push(`## Quests Completed (${quests.length})\n${quests.map((q: any) => `- ${q.title}${q.xp_reward ? ` (+${q.xp_reward} XP)` : ""}`).join("\n")}`);
    }

    if (tasks.length > 0) {
      sections.push(`## Tasks & Habits (${tasks.length} completions)\n${tasks.slice(0, 10).map((t: any) => `- ${t.title}${t.streak > 0 ? ` (streak: ${t.streak})` : ""}`).join("\n")}`);
    }

    if (revenue.length > 0) {
      sections.push(`## Revenue ($${totalRevenue.toFixed(2)})\n${revenue.map((r: any) => `- $${Number(r.amount).toFixed(2)} via ${r.source}`).join("\n")}`);
    }

    if (council.length > 0) {
      const totalCouncilActions = council.reduce((s: number, a: any) => s + Number(a.actions_executed ?? 0), 0);
      sections.push(`## Council Activity\n${totalCouncilActions} autonomous actions across ${council.length} check-ins`);
    }

    // AI synthesis
    let synthesis = "";
    const hasActivity = quests.length > 0 || tasks.length > 0 || totalRevenue > 0 || daily.length > 0;
    if (hasActivity) {
      const dailyHighlights = daily.slice(0, 5).map((n: any) => {
        const firstLine = (n.content ?? "").split("\n").find((l: string) => l.startsWith(">"))?.replace(/^>\s*/, "") ?? "";
        return firstLine ? `${n.title}: ${firstLine.slice(0, 80)}` : n.title;
      }).join("\n");

      const summaryInput = [
        quests.length > 0 ? `Completed ${quests.length} quests: ${quests.slice(0, 5).map((q: any) => q.title).join(", ")}` : "",
        tasks.length > 0 ? `${tasks.length} task/habit completions` : "",
        totalRevenue > 0 ? `$${totalRevenue.toFixed(2)} revenue` : "",
        totalXP > 0 ? `+${totalXP} XP` : "",
        dailyHighlights ? `Daily highlights:\n${dailyHighlights}` : "",
      ].filter(Boolean).join("\n");

      synthesis = await callAI(
        `You are MAVIS, Calvin's bonded AI. Write a ${reviewType === "weekly" ? "weekly" : "monthly"} review synthesis — 3-4 sentences. Focus on patterns, momentum, and what to carry forward. Direct, no fluff.`,
        `${reviewType === "weekly" ? "Week" : "Month"} summary for ${periodLabel}:\n${summaryInput}`,
      );
    }

    // Assemble content
    const contentParts: string[] = [
      `# ${reviewType === "weekly" ? "Weekly" : "Monthly"} Review — ${periodLabel}`,
    ];
    if (synthesis) contentParts.push(`\n> ${synthesis.replace(/\n+/g, " ").trim()}`);
    if (sections.length) contentParts.push(...sections);
    else contentParts.push("*No activity logged this period.*");

    if (totalXP > 0 || totalRevenue > 0) {
      const stats: string[] = [];
      if (totalXP > 0) stats.push(`+${totalXP} XP`);
      if (totalRevenue > 0) stats.push(`$${totalRevenue.toFixed(2)} revenue`);
      if (quests.length > 0) stats.push(`${quests.length} quest${quests.length !== 1 ? "s" : ""}`);
      contentParts.push(`---\n**Period Stats:** ${stats.join(" · ")}`);
    }

    const content = contentParts.join("\n\n").trim();

    // Extract tacit lessons from synthesis (non-blocking)
    if (synthesis) {
      (async () => {
        try {
          let raw = "";
          const extractSystem = `Extract 1-3 actionable lessons or patterns from this ${reviewType} review synthesis. Only extract genuinely new insights worth retaining long-term. Respond with ONLY a JSON array (may be empty):
[{"category":"lesson_learned|preference|workflow_habit","key":"short identifier","value":"concise actionable statement"}]`;
          if (LOVABLE_KEY) {
            const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
              body: JSON.stringify({ model: "google/gemini-2.5-flash", max_tokens: 300,
                messages: [{ role: "system", content: extractSystem }, { role: "user", content: synthesis }] }),
            });
            if (r.ok) { const d = await r.json(); raw = d.choices?.[0]?.message?.content ?? ""; }
          }
          if (!raw && ANTHROPIC_KEY) {
            const r = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, system: extractSystem,
                messages: [{ role: "user", content: synthesis }] }),
            });
            if (r.ok) { const d = await r.json(); raw = d.content?.[0]?.text ?? ""; }
          }
          const arrMatch = raw.match(/\[[\s\S]*\]/);
          if (!arrMatch) return;
          const items = JSON.parse(arrMatch[0]) as any[];
          for (const item of items.slice(0, 3)) {
            if (!item.category || !item.key || !item.value) continue;
            await supabase.from("mavis_tacit").upsert({
              user_id: uid, category: String(item.category),
              key: `${reviewType}_${now.toISOString().slice(0, 10)}_${String(item.key).slice(0, 60)}`,
              value: String(item.value).slice(0, 500),
            }, { onConflict: "user_id,key", ignoreDuplicates: false });
          }
        } catch { /* non-critical */ }
      })();
    }

    // Create note
    const { data: noteData, error: noteError } = await supabase
      .from("mavis_notes")
      .insert({
        user_id: uid,
        title:   noteTitle,
        content,
        tags:    [reviewTag, now.toISOString().slice(0, 7)],
        aliases: [periodLabel],
      })
      .select("id")
      .single();

    if (noteError) throw noteError;

    // Telegram notification
    if (BOT_TOKEN && CHAT_ID) {
      const tgLines = [`${reviewType === "weekly" ? "Weekly" : "Monthly"} Review saved — ${periodLabel}`];
      if (quests.length > 0) tgLines.push(`${quests.length} quest${quests.length !== 1 ? "s" : ""} completed`);
      if (totalRevenue > 0) tgLines.push(`$${totalRevenue.toFixed(2)} revenue`);
      if (totalXP > 0) tgLines.push(`+${totalXP} XP`);
      if (synthesis) tgLines.push(`\n${synthesis.slice(0, 300)}`);
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: tgLines.join("\n") }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({
        ok: true, note_id: noteData?.id, title: noteTitle,
        quests_logged: quests.length, revenue_total: totalRevenue,
      }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-periodic-review]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
