// MAVIS Quest Deadline Nudge
// Fires twice daily (08:00 and 18:00 UTC via pg_cron).
// Sends Telegram alerts for quests due in the next 24–48 hours so
// Calvin never misses a deadline due to lack of awareness.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…[truncated]" : text;
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

    // Window: quests due in the next 48 hours that aren't already overdue
    const windowStart = now.toISOString().slice(0, 10); // today (exclusive of past)
    const windowEnd   = new Date(now.getTime() + 48 * 3600000).toISOString().slice(0, 10);

    const { data: upcoming, error } = await supabase
      .from("quests")
      .select("id, title, type, deadline, xp_reward, progress_current, progress_target")
      .eq("user_id", uid)
      .eq("status", "active")
      .gte("deadline", windowStart)
      .lte("deadline", windowEnd)
      .not("deadline", "is", null)
      .order("deadline", { ascending: true });

    if (error) throw error;

    if (!upcoming?.length) {
      return new Response(JSON.stringify({ ok: true, nudged: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const lines: string[] = ["QUEST DEADLINE ALERT"];

    for (const q of upcoming as any[]) {
      const deadlineDate = new Date(q.deadline + "T00:00:00Z");
      const hoursLeft    = Math.round((deadlineDate.getTime() - now.getTime()) / 3600000);
      const urgency      = hoursLeft <= 24 ? "⚠ DUE TOMORROW" : "DUE IN 2 DAYS";
      const progress     = (q.progress_target > 0)
        ? ` [${q.progress_current}/${q.progress_target}]`
        : "";
      lines.push(`${urgency}: ${q.title}${progress}`);
      lines.push(`  Type: ${q.type} | XP: +${q.xp_reward ?? 0} | Deadline: ${q.deadline}`);
    }

    lines.push(`\n${upcoming.length} quest${upcoming.length !== 1 ? "s" : ""} need attention before the deadline.`);

    await sendTelegram(lines.join("\n"));

    return new Response(
      JSON.stringify({ ok: true, nudged: upcoming.length }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-quest-nudge]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
