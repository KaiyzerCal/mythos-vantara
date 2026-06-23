import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const targetDate = String(body.date ?? new Date().toISOString().slice(0, 10));
    const sevenDaysAgo = new Date(new Date(targetDate).getTime() - 7 * 86400000).toISOString();

    const dataSections: string[] = [];

    // health_metrics is the canonical source; others are best-effort
    const { data: metrics } = await sb
      .from("health_metrics")
      .select("metric_type, value, unit, recorded_at")
      .eq("user_id", user.id)
      .gte("recorded_at", sevenDaysAgo)
      .order("recorded_at", { ascending: false })
      .limit(100);

    if (metrics?.length) {
      dataSections.push(
        `HEALTH METRICS (last 7 days):\n${metrics.map((m) =>
          `${m.metric_type}: ${m.value} ${m.unit ?? ""} (${String(m.recorded_at).slice(0, 10)})`
        ).join("\n")}`,
      );
    }

    // Try Oura-style table — table name may vary across deployments
    const ouraTableNames = ["oura_data", "oura_daily_data"];
    for (const tbl of ouraTableNames) {
      try {
        const { data: oura } = await sb
          .from(tbl)
          .select("date, hrv, resting_hr, sleep_score, readiness_score, activity_score")
          .eq("user_id", user.id)
          .gte("date", sevenDaysAgo.slice(0, 10))
          .order("date", { ascending: false })
          .limit(7);
        if (oura?.length) {
          dataSections.push(
            `OURA (${tbl}, last 7 days):\n${oura.map((o) =>
              `${o.date} — HRV:${o.hrv ?? "?"} rHR:${o.resting_hr ?? "?"} sleep:${o.sleep_score ?? "?"} readiness:${o.readiness_score ?? "?"} activity:${o.activity_score ?? "?"}`
            ).join("\n")}`,
          );
          break;
        }
      } catch { /* table doesn't exist */ }
    }

    // Try WHOOP-style table
    const whoopTableNames = ["whoop_data", "whoop_daily_data"];
    for (const tbl of whoopTableNames) {
      try {
        const { data: whoop } = await sb
          .from(tbl)
          .select("date, recovery_score, strain_score, sleep_hours, hrv_rmssd, resting_hr")
          .eq("user_id", user.id)
          .gte("date", sevenDaysAgo.slice(0, 10))
          .order("date", { ascending: false })
          .limit(7);
        if (whoop?.length) {
          dataSections.push(
            `WHOOP (${tbl}, last 7 days):\n${whoop.map((w) =>
              `${w.date} — recovery:${w.recovery_score ?? "?"} strain:${w.strain_score ?? "?"} sleep:${w.sleep_hours ?? "?"}h HRV:${w.hrv_rmssd ?? "?"} rHR:${w.resting_hr ?? "?"}`
            ).join("\n")}`,
          );
          break;
        }
      } catch { /* table doesn't exist */ }
    }

    // Try Strava activities
    try {
      const { data: activities } = await sb
        .from("strava_activities")
        .select("start_date, sport_type, distance, moving_time, name")
        .eq("user_id", user.id)
        .gte("start_date", sevenDaysAgo)
        .order("start_date", { ascending: false })
        .limit(10);
      if (activities?.length) {
        dataSections.push(
          `STRAVA ACTIVITIES (last 7 days):\n${activities.map((a) =>
            `${String(a.start_date).slice(0, 10)} — ${a.sport_type ?? "activity"}: ${a.name ?? ""} ${a.distance ? `${Math.round(Number(a.distance) / 100) / 10}km` : ""} ${a.moving_time ? `${Math.round(Number(a.moving_time) / 60)}min` : ""}`
          ).join("\n")}`,
        );
      }
    } catch { /* table doesn't exist */ }

    if (!dataSections.length) {
      return json({
        protocol: null,
        message: "No health data found. Connect your wearables in Integrations.",
      });
    }

    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const dataSummary = dataSections.join("\n\n");

    const synthesisRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: "You are an elite performance coach. Based on biometric data, generate a specific, actionable daily protocol. Return only valid JSON.",
        messages: [{
          role: "user",
          content: `Date: ${targetDate}\n\nBiometric data:\n${dataSummary}\n\nReturn JSON:\n{\n  "readiness_score": number (0-100),\n  "energy_recommendation": string,\n  "training_recommendation": { "type": string, "intensity": string, "duration": string, "notes": string },\n  "nutrition_focus": string[],\n  "sleep_target": string,\n  "top_priority": string,\n  "warnings": string[]\n}`,
        }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!synthesisRes.ok) {
      throw new Error(`Anthropic error ${synthesisRes.status}: ${await synthesisRes.text()}`);
    }

    const synthesisData = await synthesisRes.json();
    const rawText = synthesisData.content?.[0]?.text ?? "{}";

    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in LLM response");
    const protocol = JSON.parse(match[0]);

    // Store in mavis_memory so MAVIS can reference it conversationally
    await sb.from("mavis_memory").insert({
      user_id:         user.id,
      role:            "assistant",
      content:         `Health protocol for ${targetDate}: readiness ${protocol.readiness_score}/100. Priority: ${protocol.top_priority}. Training: ${protocol.training_recommendation?.type} ${protocol.training_recommendation?.intensity}.`,
      importance_score: 6,
      source:          "mavis-health-protocol",
      consolidated:    false,
    }).catch(() => { /* non-critical */ });

    return json({ protocol, date: targetDate, data_sources: dataSections.length });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
