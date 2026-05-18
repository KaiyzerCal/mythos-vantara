import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

interface HealthMetric {
  sleep_score: number | null;
  readiness_score: number | null;
  hrv_avg: number | null;
  resting_hr: number | null;
  sleep_duration_minutes: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  recorded_at: string;
}

function avg(values: (number | null)[]): number | null {
  const filtered = values.filter((v): v is number => v !== null && v !== undefined);
  if (filtered.length === 0) return null;
  return Math.round(filtered.reduce((s, v) => s + v, 0) / filtered.length);
}

function trend(today: number | null, average: number | null): string {
  if (today === null || average === null) return "unknown";
  const diff = today - average;
  if (Math.abs(diff) < 2) return "stable";
  return diff > 0 ? "improving" : "declining";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;

    // Query last 7 days of health metrics
    const { data: metrics, error: metricsError } = await supabase
      .from("health_metrics")
      .select(
        "sleep_score, readiness_score, hrv_avg, resting_hr, sleep_duration_minutes, deep_sleep_minutes, rem_sleep_minutes, recorded_at"
      )
      .eq("user_id", uid)
      .order("recorded_at", { ascending: false })
      .limit(7);

    if (metricsError || !metrics || metrics.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "No health data" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const records: HealthMetric[] = metrics;
    const today = records[0]; // Most recent

    // Compute 7-day averages
    const avgSleep = avg(records.map((r) => r.sleep_score));
    const avgReadiness = avg(records.map((r) => r.readiness_score));
    const avgHrv = avg(records.map((r) => r.hrv_avg));
    const avgRestingHr = avg(records.map((r) => r.resting_hr));
    const avgSleepDuration = avg(records.map((r) => r.sleep_duration_minutes));
    const avgDeepSleep = avg(records.map((r) => r.deep_sleep_minutes));
    const avgRemSleep = avg(records.map((r) => r.rem_sleep_minutes));

    // Build biometric context
    const contextLines: string[] = [
      "Biometric Report",
      `Date: ${today.recorded_at.slice(0, 10)}`,
      "",
      "Today's values vs 7-day averages:",
      `  Sleep Score:       ${today.sleep_score ?? "N/A"} (avg: ${avgSleep ?? "N/A"}) — ${trend(today.sleep_score, avgSleep)}`,
      `  Readiness Score:   ${today.readiness_score ?? "N/A"} (avg: ${avgReadiness ?? "N/A"}) — ${trend(today.readiness_score, avgReadiness)}`,
      `  HRV:               ${today.hrv_avg ?? "N/A"}ms (avg: ${avgHrv ?? "N/A"}ms) — ${trend(today.hrv_avg, avgHrv)}`,
      `  Resting HR:        ${today.resting_hr ?? "N/A"}bpm (avg: ${avgRestingHr ?? "N/A"}bpm)`,
      `  Sleep Duration:    ${today.sleep_duration_minutes ?? "N/A"}min (avg: ${avgSleepDuration ?? "N/A"}min)`,
      `  Deep Sleep:        ${today.deep_sleep_minutes ?? "N/A"}min (avg: ${avgDeepSleep ?? "N/A"}min)`,
      `  REM Sleep:         ${today.rem_sleep_minutes ?? "N/A"}min (avg: ${avgRemSleep ?? "N/A"}min)`,
      "",
      "Last 7 days sleep scores: " +
        records.map((r) => r.sleep_score ?? "—").reverse().join(", "),
      "Last 7 days readiness:    " +
        records.map((r) => r.readiness_score ?? "—").reverse().join(", "),
    ];

    const contextStr = contextLines.join("\n");

    // Call Claude Sonnet
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system:
          "You are MAVIS acting as a recovery and performance coach. Analyze the operator's biometric data and give 3-4 specific, actionable recommendations for today. Categories: training intensity (high/moderate/rest), sleep optimization, energy management. Be direct and data-driven. Reference specific numbers.",
        messages: [{ role: "user", content: contextStr }],
      }),
    });

    const anthropicData = await anthropicRes.json();
    const coachingText: string =
      anthropicData.content?.[0]?.text ?? "No coaching generated.";

    // Format summary values for Telegram footer
    const todayScore = today.sleep_score ?? "N/A";
    const todayHrv = today.hrv_avg ?? "N/A";
    const todayReadiness = today.readiness_score ?? "N/A";

    // Send Telegram notification
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const chatId = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID")!;
    const telegramMsg =
      `MAVIS SLEEP COACH 💤\n─────\n${coachingText}\n\nData: Sleep ${todayScore} (7d avg: ${avgSleep ?? "N/A"}) · HRV ${todayHrv}ms (avg: ${avgHrv ?? "N/A"}ms) · Readiness ${todayReadiness}`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: telegramMsg }),
    });

    return new Response(
      JSON.stringify({ ok: true, coaching: coachingText }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("mavis-sleep-coach error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
