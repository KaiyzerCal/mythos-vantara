// MAVIS Spaced Repetition
// Surfaces forgotten notes at expanding intervals (7→14→21→30→45→90 days).
// Prioritises notes tagged #lesson, #insight, #principle, #strategy, #system.
// Triggered daily at 08:00 UTC via pg_cron, or by /review Telegram command.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

const PRIORITY_TAGS = new Set(["lesson", "insight", "principle", "strategy", "system", "rule", "learning"]);

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

    // Load notes due for review (or never reviewed after 7+ days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const { data: candidates, error } = await supabase
      .from("mavis_notes")
      .select("id, title, content, tags, review_interval_days, next_review_at, created_at")
      .eq("user_id", uid)
      .or(`next_review_at.is.null,next_review_at.lte.${now.toISOString()}`)
      .order("next_review_at", { ascending: true })
      .limit(40);

    if (error) throw error;

    if (!candidates?.length) {
      await sendTelegram("MAVIS REVIEW\n\nNo notes due for review today. All caught up.");
      return new Response(JSON.stringify({ ok: true, reviewed: 0 }));
    }

    // Filter out daily-log notes and notes too recently created
    const eligible = (candidates as any[]).filter(n => {
      if (n.tags?.includes("daily-log") || n.tags?.includes("weekly-review") || n.tags?.includes("monthly-review")) return false;
      if (!n.next_review_at && new Date(n.created_at) > new Date(sevenDaysAgo)) return false;
      return true;
    });

    if (!eligible.length) {
      return new Response(JSON.stringify({ ok: true, reviewed: 0, message: "No eligible notes today" }));
    }

    // Prioritise high-value tags, then oldest
    eligible.sort((a, b) => {
      const aP = (a.tags ?? []).some((t: string) => PRIORITY_TAGS.has(t)) ? 0 : 1;
      const bP = (b.tags ?? []).some((t: string) => PRIORITY_TAGS.has(t)) ? 0 : 1;
      if (aP !== bP) return aP - bP;
      return new Date(a.next_review_at ?? a.created_at).getTime() - new Date(b.next_review_at ?? b.created_at).getTime();
    });

    const toReview = eligible.slice(0, 3);

    // Format and send review message
    const lines = ["MAVIS REVIEW — Daily Knowledge Refresh\n"];
    for (let i = 0; i < toReview.length; i++) {
      const n = toReview[i];
      const preview = (n.content ?? "").replace(/#+\s/g, "").replace(/\n+/g, " ").trim().slice(0, 280);
      const tags    = n.tags?.length ? ` [${n.tags.slice(0, 3).join(", ")}]` : "";
      const days    = n.review_interval_days ?? 7;
      lines.push(`${i + 1}. ${n.title}${tags}\n${preview}${preview.length >= 280 ? "…" : ""}\n(Interval: every ${days} days)\n`);
    }

    await sendTelegram(lines.join("\n"));

    // Update review state for each surfaced note
    const updates = toReview.map(async (n: any) => {
      const currentInterval = n.review_interval_days ?? 7;
      const newInterval     = Math.min(90, Math.round(currentInterval * 1.5));
      const nextReview      = new Date(now.getTime() + newInterval * 86400000).toISOString();
      return supabase.from("mavis_notes").update({
        last_reviewed_at:     now.toISOString(),
        next_review_at:       nextReview,
        review_interval_days: newInterval,
      }).eq("id", n.id);
    });
    await Promise.all(updates);

    return new Response(
      JSON.stringify({ ok: true, reviewed: toReview.length }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-spaced-repetition]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
