// mavis-event-dispatcher — Realtime database event handler
// Called by Supabase database webhooks when key rows change.
// Handles: quest_completed, journal_created, expense_logged, task_completed
// Routes each event to the appropriate MAVIS response (Telegram alert,
// emotion tag, budget check, next-quest suggestion, XP award, etc.)

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const supabase  = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID   = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-webhook-secret",
};

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function onQuestCompleted(record: any, user_id: string) {
  // Suggest a next quest
  const { data: activeCount } = await supabase.from("quests")
    .select("id", { count: "exact" })
    .eq("user_id", user_id)
    .eq("status", "active");

  const res = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system:     "You are MAVIS congratulating the user on completing a quest. Be brief, energetic, and suggest what to focus on next. 2-3 sentences max.",
    messages:   [{
      role:    "user",
      content: `Quest completed: "${record.title}" (${record.type}, ${record.xp_reward ?? 0} XP). User has ${(activeCount as any)?.length ?? 0} active quests remaining.`,
    }],
  });

  const msg = ((res.content[0] as any).text ?? "").trim();
  await sendTelegram(`*QUEST COMPLETE* ✅\n*${record.title}* — +${record.xp_reward ?? 0} XP\n\n${msg}`);

  // Store as memory
  await supabase.from("memories").insert({
    user_id,
    title:       `Quest completed: ${record.title}`,
    content:     `Completed ${record.type} quest "${record.title}" for ${record.xp_reward ?? 0} XP.`,
    memory_type: "auto",
    tags:        ["quest", "completion", record.type],
  }).catch(() => {});
}

async function onJournalCreated(record: any, user_id: string) {
  // Tag emotional content and store mood signal
  if (!record.mood && record.content) {
    const res = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 60,
      system:     'Respond ONLY with valid JSON: {"mood": "one word", "energy": "low|medium|high", "themes": ["array", "of", "topics"]}',
      messages:   [{ role: "user", content: `Analyze mood from: "${String(record.content).slice(0, 500)}"` }],
    });
    try {
      const parsed = JSON.parse(((res.content[0] as any).text ?? "").trim());
      if (parsed.mood) {
        await supabase.from("journal_entries")
          .update({ mood: parsed.mood, tags: parsed.themes ?? [] })
          .eq("id", record.id)
          .catch(() => {});
      }
    } catch { /* non-critical */ }
  }

  // Store as memory for context-scout
  const preview = String(record.content ?? "").replace(/<[^>]+>/g, "").trim().slice(0, 200);
  if (preview.length > 20) {
    await supabase.from("memories").insert({
      user_id,
      title:       `Journal: ${record.title ?? new Date().toISOString().slice(0, 10)}`,
      content:     preview,
      memory_type: "episodic",
      tags:        ["journal", ...(record.tags ?? [])],
    }).catch(() => {});
  }
}

async function onExpenseLogged(record: any, user_id: string) {
  // Check against budget thresholds
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { data: expenses } = await supabase.from("mavis_expenses")
    .select("amount")
    .eq("user_id", user_id)
    .gte("expense_date", thirtyAgo);

  const total30 = (expenses ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0);
  const MONTHLY_WARN_THRESHOLD = 5000; // configurable

  if (total30 > MONTHLY_WARN_THRESHOLD) {
    await supabase.from("mavis_insights").insert({
      user_id,
      title:    `Monthly spend exceeded $${MONTHLY_WARN_THRESHOLD}`,
      content:  `30-day total: $${total30.toFixed(2)}. Latest: ${record.description} ($${Number(record.amount).toFixed(2)}).`,
      category: "finance",
      severity: "warning",
    }).catch(() => {});
  }
}

async function onTaskCompleted(record: any, user_id: string) {
  if ((record.streak ?? 0) >= 7 && record.streak % 7 === 0) {
    await sendTelegram(`*STREAK MILESTONE* 🔥\n*${record.title}* — ${record.streak} day streak! Keep it going.`);
  }

  // Store habit completion as memory at weekly milestones
  if ((record.streak ?? 0) >= 7) {
    await supabase.from("memories").insert({
      user_id,
      title:       `Streak: ${record.title} — ${record.streak}d`,
      content:     `Maintained "${record.title}" habit for ${record.streak} consecutive days.`,
      memory_type: "auto",
      tags:        ["habit", "streak"],
    }).catch(() => {});
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // Webhook secret validation (set WEBHOOK_SECRET env var in Supabase dashboard)
    const secret = req.headers.get("x-webhook-secret") ?? "";
    const expectedSecret = Deno.env.get("WEBHOOK_SECRET") ?? "";
    if (expectedSecret && secret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    const body = await req.json() as {
      type:   "INSERT" | "UPDATE" | "DELETE";
      table:  string;
      record: Record<string, unknown>;
      old_record?: Record<string, unknown>;
      schema: string;
    };

    const { type, table, record } = body;
    const user_id = String(record?.user_id ?? "");

    if (!user_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "no user_id" }), { headers: CORS });
    }

    // Route events
    if (table === "quests" && type === "UPDATE" && record.status === "completed" && body.old_record?.status !== "completed") {
      await onQuestCompleted(record, user_id);
    } else if (table === "journal_entries" && type === "INSERT") {
      await onJournalCreated(record, user_id);
    } else if (table === "mavis_expenses" && type === "INSERT") {
      await onExpenseLogged(record, user_id);
    } else if (table === "tasks" && type === "UPDATE" && record.status === "done" && body.old_record?.status !== "done") {
      await onTaskCompleted(record, user_id);
    }

    return new Response(JSON.stringify({ ok: true, table, type }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (err) {
    console.error("[mavis-event-dispatcher]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
