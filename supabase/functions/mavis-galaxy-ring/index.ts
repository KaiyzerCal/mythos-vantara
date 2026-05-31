// MAVIS Samsung Galaxy Ring
// Developer-beta integration for cognitive health, HRV, stress, and SpO2 metrics.
// Falls back to a structured mock when GALAXY_RING_API_KEY is not configured.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GALAXY_BASE = Deno.env.get("GALAXY_RING_API_URL") ?? "https://api.samsung.com/health/v1";
const GALAXY_KEY  = Deno.env.get("GALAXY_RING_API_KEY") ?? "";

// ─────────────────────────────────────────────────────────────
// Galaxy Ring API fetch helper
// ─────────────────────────────────────────────────────────────

async function galaxyFetch(path: string): Promise<any> {
  const res = await fetch(`${GALAXY_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${GALAXY_KEY}`,
      "x-api-key": GALAXY_KEY,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Galaxy Ring API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Mock data structure (returned when API key not configured)
// ─────────────────────────────────────────────────────────────

function buildMockResponse(date: string): object {
  return {
    status: "mock",
    message: "Samsung Galaxy Ring API key not configured. Returning mock structure.",
    data: {
      date,
      sleep_score: null,
      cognitive_score: null,
      stress_level: null,
      hrv: null,
      spo2: null,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Action handlers
// ─────────────────────────────────────────────────────────────

async function getMetrics(date: string): Promise<any> {
  const data = await galaxyFetch(`/ring/metrics?date=${date}`);
  return {
    date,
    sleep_score:   data?.sleep?.score          ?? null,
    spo2:          data?.spo2?.average          ?? null,
    heart_rate:    data?.heart_rate?.resting    ?? null,
    skin_temp_c:   data?.skin_temperature?.avg_c ?? null,
    steps:         data?.activity?.steps        ?? null,
    active_calories: data?.activity?.active_calories ?? null,
    raw: data,
  };
}

async function getCognitiveScore(date: string): Promise<any> {
  const data = await galaxyFetch("/ring/cognitive");
  return {
    date,
    cognitive_score: data?.cognitive_load_score ?? null,
    focus_score:     data?.focus_score          ?? null,
    mental_clarity:  data?.mental_clarity       ?? null,
    raw: data,
  };
}

async function getStress(date: string): Promise<any> {
  const data = await galaxyFetch("/ring/stress");
  return {
    date,
    stress_level:    data?.stress_level    ?? null,
    hrv_rmssd:       data?.hrv_rmssd       ?? null,
    recovery_index:  data?.recovery_index  ?? null,
    raw: data,
  };
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const jwt = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: { action: string; user_id?: string; date?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { action, date: bodyDate } = body;
  const date   = bodyDate ?? new Date().toISOString().split("T")[0];
  const userId = user.id;

  // If Galaxy Ring API key is not configured, return mock for data endpoints
  if (!GALAXY_KEY && action !== "sync") {
    return new Response(
      JSON.stringify(buildMockResponse(date)),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    switch (action) {
      case "get_metrics": {
        if (!GALAXY_KEY) {
          return new Response(
            JSON.stringify(buildMockResponse(date)),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const metrics = await getMetrics(date);
        return new Response(
          JSON.stringify({ metrics }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "get_cognitive_score": {
        if (!GALAXY_KEY) {
          return new Response(
            JSON.stringify(buildMockResponse(date)),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const cognitive = await getCognitiveScore(date);
        return new Response(
          JSON.stringify({ cognitive }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "get_stress": {
        if (!GALAXY_KEY) {
          return new Response(
            JSON.stringify(buildMockResponse(date)),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const stress = await getStress(date);
        return new Response(
          JSON.stringify({ stress }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "sync": {
        // If key not configured, return mock and skip upsert
        if (!GALAXY_KEY) {
          return new Response(
            JSON.stringify(buildMockResponse(date)),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Fetch all metrics in parallel; cognitive and stress may fail if beta endpoint unavailable
        const [metrics, cognitive, stress] = await Promise.allSettled([
          getMetrics(date),
          getCognitiveScore(date),
          getStress(date),
        ]);

        const metricsData   = metrics.status   === "fulfilled" ? metrics.value   : {};
        const cognitiveData = cognitive.status === "fulfilled" ? cognitive.value : {};
        const stressData    = stress.status    === "fulfilled" ? stress.value    : {};

        const upsertRow = {
          user_id:          userId,
          date,
          sleep_score:      metricsData.sleep_score     ?? null,
          cognitive_score:  cognitiveData.cognitive_score ?? null,
          stress_level:     stressData.stress_level      ?? null,
          hrv_rmssd:        stressData.hrv_rmssd          ?? null,
          spo2:             metricsData.spo2              ?? null,
          skin_temp_c:      metricsData.skin_temp_c       ?? null,
          steps:            metricsData.steps             ?? null,
          active_calories:  metricsData.active_calories   ?? null,
          raw_data: {
            metrics:   metricsData.raw   ?? null,
            cognitive: cognitiveData.raw ?? null,
            stress:    stressData.raw    ?? null,
          },
          synced_at: new Date().toISOString(),
        };

        const { error: upsertErr } = await supabase
          .from("galaxy_ring_daily_data")
          .upsert(upsertRow, { onConflict: "user_id,date" });

        if (upsertErr) {
          console.error("[mavis-galaxy-ring] upsert error:", upsertErr.message);
          return new Response(
            JSON.stringify({ error: `Database upsert failed: ${upsertErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            date,
            metrics:   metricsData,
            cognitive: cognitiveData,
            stress:    stressData,
            synced_at: upsertRow.synced_at,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      default:
        return new Response(
          JSON.stringify({
            error: `Unknown action: ${action}. Valid actions: get_metrics, get_cognitive_score, get_stress, sync`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (e: any) {
    console.error("[mavis-galaxy-ring] error:", e?.message);
    return new Response(
      JSON.stringify({ error: e?.message }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
