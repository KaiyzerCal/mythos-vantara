// mavis-health-monitor
// Runs hourly via pg_cron.
// Checks mavis_function_health for stale or errored background functions.
// Sends a Telegram alert for anything that hasn't run within its expected window.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

// Grace multiplier: alert if a function is more than 1.5× overdue
const GRACE = 1.5;

async function tgAlert(text: string): Promise<void> {
  if (!BOT_TOKEN || !OPERATOR_CHAT) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: OPERATOR_CHAT, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });

  const sb  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = new Date();

  // Heartbeat: mark this function itself as healthy
  sb.from("mavis_function_health").upsert({
    function_name: "mavis-health-monitor",
    last_started_at: now.toISOString(),
    last_completed_at: now.toISOString(),
    last_status: "ok",
    run_count: 1,
    expected_interval_min: 60,
    updated_at: now.toISOString(),
  }, { onConflict: "function_name" }).catch(() => {});

  try {
    const { data: rows } = await sb
      .from("mavis_function_health")
      .select("*")
      .order("function_name");

    const health = (rows ?? []) as any[];
    const alerts: string[] = [];
    const statusLines: string[] = [];

    for (const row of health) {
      if (row.function_name === "mavis-health-monitor") continue; // skip self

      const lastCompleted = row.last_completed_at ? new Date(row.last_completed_at) : null;
      const minutesSince  = lastCompleted
        ? (now.getTime() - lastCompleted.getTime()) / 60000
        : Infinity;
      const threshold = (row.expected_interval_min ?? 60) * GRACE;

      if (row.last_status === "error") {
        alerts.push(`🔴 *${row.function_name}* — last run errored:\n  ${(row.last_error ?? "unknown error").slice(0, 120)}`);
      } else if (minutesSince > threshold) {
        // Only alert for non-daily functions being stale (daily jobs may just not have run yet today)
        const isDailyOrLonger = (row.expected_interval_min ?? 60) >= 1440;
        if (!isDailyOrLonger) {
          const humanTime = lastCompleted ? `${Math.round(minutesSince)}m ago` : "never";
          alerts.push(`🟡 *${row.function_name}* — stale (last run: ${humanTime}, expected every ${row.expected_interval_min}m)`);
        }
      }

      const emoji = row.last_status === "ok" ? "✅" : row.last_status === "error" ? "🔴" : row.last_status === "running" ? "🔄" : "⚪";
      const lastRun = lastCompleted
        ? lastCompleted.toISOString().slice(0, 16).replace("T", " ") + " UTC"
        : "never";
      statusLines.push(`${emoji} ${row.function_name}\n   Last: ${lastRun} · Runs: ${row.run_count} · Errors: ${row.error_count}`);
    }

    if (alerts.length > 0) {
      await tgAlert(`🏥 *MAVIS System Health Alert*\n\n${alerts.join("\n\n")}`);
    }

    return new Response(JSON.stringify({
      ok:        true,
      checked:   health.length,
      alerts:    alerts.length,
      statusLines,
      checkedAt: now.toISOString(),
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await tgAlert(`🔴 *MAVIS Health Monitor crashed*\n${msg.slice(0, 200)}`);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
