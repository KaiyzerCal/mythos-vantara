// MAVIS Streak Break Alerts
// Fires at 20:00 UTC daily. Finds daily/weekly habit tasks with active streaks
// that haven't been completed today, and sends a Telegram nudge before midnight.

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
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
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
    const todayIso = now.toISOString().slice(0, 10);

    // Load active daily tasks with streaks at risk
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, title, recurrence, streak, last_completed_at")
      .eq("user_id", uid)
      .eq("status", "active")
      .eq("recurrence", "daily")
      .gt("streak", 0)
      .order("streak", { ascending: false });

    if (!tasks?.length) {
      return new Response(JSON.stringify({ ok: true, at_risk: 0 }));
    }

    // Find tasks not completed today
    const atRisk = (tasks as any[]).filter(t => {
      if (!t.last_completed_at) return true;
      return t.last_completed_at.slice(0, 10) < todayIso;
    });

    if (!atRisk.length) {
      return new Response(JSON.stringify({ ok: true, at_risk: 0, message: "All streaks safe" }));
    }

    // Sort by longest streak first (highest stakes)
    atRisk.sort((a: any, b: any) => (b.streak ?? 0) - (a.streak ?? 0));

    const lines = atRisk.map((t: any) =>
      `• ${t.title} — ${t.streak}-day streak at risk`
    ).join("\n");

    const totalStreakDays = atRisk.reduce((s: number, t: any) => s + (t.streak ?? 0), 0);

    await sendTelegram(
      `STREAK ALERT — 4 hours to midnight\n\n${lines}\n\n${atRisk.length} habit${atRisk.length !== 1 ? "s" : ""} · ${totalStreakDays} total streak days on the line.\n\nComplete them in the Tasks tab or tell MAVIS you finished.`
    );

    return new Response(
      JSON.stringify({ ok: true, at_risk: atRisk.length }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-streak-alerts]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
