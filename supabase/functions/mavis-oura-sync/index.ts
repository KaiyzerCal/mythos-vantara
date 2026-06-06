// MAVIS Oura Sync
// Ingests sleep, heart rate, and daily readiness data from the Oura Ring API v2.
// Upserts records into the health_metrics table for the authenticated user.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toDatetimeString(d: Date): string {
  return d.toISOString();
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
}

// ─────────────────────────────────────────────────────────────
// Oura API fetch helper
// ─────────────────────────────────────────────────────────────

async function fetchOura(endpoint: string, token: string, params: Record<string, string>): Promise<any[]> {
  const url = new URL(`https://api.ouraring.com/v2/usercollection/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Oura API error [${endpoint}] (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  return Array.isArray(data?.data) ? data.data : [];
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: bearer token
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

  let body: { oura_token: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { oura_token, days = 7 } = body;

  if (!oura_token?.trim()) {
    return new Response(
      JSON.stringify({ error: "oura_token is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const safeDays     = Math.min(Math.max(1, days), 90);
  const endDate      = new Date();
  const startDate    = addDays(endDate, -safeDays);
  const startDateStr = toDateString(startDate);
  const endDateStr   = toDateString(endDate);

  // Fetch all three endpoints in parallel
  let sleepData:     any[] = [];
  let hrData:        any[] = [];
  let readinessData: any[] = [];

  try {
    [sleepData, hrData, readinessData] = await Promise.all([
      fetchOura("sleep", oura_token, { start_date: startDateStr, end_date: endDateStr }),
      fetchOura("heartrate", oura_token, {
        start_datetime: toDatetimeString(startDate),
        end_datetime:   toDatetimeString(endDate),
      }),
      fetchOura("daily_readiness", oura_token, { start_date: startDateStr, end_date: endDateStr }),
    ]);
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Index readiness by day
  const readinessByDay: Record<string, any> = {};
  for (const r of readinessData) {
    const day = (r.day ?? r.date ?? "").slice(0, 10);
    if (day) readinessByDay[day] = r;
  }

  // Build an average HR map by date for HRV (Oura v2 heartrate is per-minute data)
  // We compute mean HR per day from the stream
  const hrByDay: Record<string, { sum: number; count: number }> = {};
  for (const sample of hrData) {
    const ts  = sample.timestamp ?? "";
    const day = ts.slice(0, 10);
    if (!day || typeof sample.bpm !== "number") continue;
    hrByDay[day] = hrByDay[day] ?? { sum: 0, count: 0 };
    hrByDay[day].sum   += sample.bpm;
    hrByDay[day].count += 1;
  }

  // Process sleep sessions
  const upsertRows: any[] = [];

  for (const session of sleepData) {
    // Sleep date (Oura uses 'day' for the date the sleep is attributed to)
    const day = (session.day ?? session.date ?? "").slice(0, 10);
    if (!day) continue;

    const readiness = readinessByDay[day];
    const hrDay     = hrByDay[day];

    // Duration in seconds → minutes
    const totalSec       = session.total_sleep_duration ?? 0;
    const deepSec        = session.deep_sleep_duration  ?? 0;
    const remSec         = session.rem_sleep_duration   ?? 0;
    const lightSec       = session.light_sleep_duration ?? 0;
    const efficiency     = session.efficiency           ?? null;
    const avgHrv         = session.average_hrv          ?? null;
    const restingHr      = session.lowest_heart_rate    ?? (hrDay ? Math.round(hrDay.sum / hrDay.count) : null);
    const readinessScore = readiness?.score              ?? null;

    upsertRows.push({
      user_id:                user.id,
      date:                   day,
      source:                 "oura",
      sleep_duration_minutes: totalSec > 0 ? Math.round(totalSec / 60) : null,
      sleep_efficiency:       efficiency,
      hrv_avg:                avgHrv,
      resting_hr:             restingHr,
      readiness_score:        readinessScore,
      deep_sleep_minutes:     deepSec  > 0 ? Math.round(deepSec  / 60) : null,
      rem_sleep_minutes:      remSec   > 0 ? Math.round(remSec   / 60) : null,
      light_sleep_minutes:    lightSec > 0 ? Math.round(lightSec / 60) : null,
      raw_data:               { sleep: session, readiness: readiness ?? null },
      created_at:             new Date().toISOString(),
    });
  }

  let synced = 0;

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("health_metrics")
      .upsert(upsertRows, { onConflict: "user_id,date,source" });

    if (upsertErr) {
      console.error("[mavis-oura-sync] upsert error:", upsertErr.message);
      return new Response(
        JSON.stringify({ error: `Database upsert failed: ${upsertErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    synced = upsertRows.length;
  }

  return new Response(
    JSON.stringify({
      synced,
      date_range: { start: startDateStr, end: endDateStr },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
