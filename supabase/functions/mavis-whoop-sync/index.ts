// MAVIS WHOOP Sync
// Integrates with the WHOOP Developer API v1 to ingest recovery, sleep, strain,
// and biomarker data. Supports OAuth2 exchange and stores tokens per-user.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const WHOOP_BASE = "https://api.prod.whoop.com/developer/v1";

// ─────────────────────────────────────────────────────────────
// WHOOP API fetch helper
// ─────────────────────────────────────────────────────────────

async function whoopFetch(path: string, token: string): Promise<any> {
  const res = await fetch(`${WHOOP_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`WHOOP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Action handlers
// ─────────────────────────────────────────────────────────────

async function getRecovery(token: string): Promise<any[]> {
  const data = await whoopFetch("/recovery?limit=7", token);
  const records = Array.isArray(data?.records) ? data.records : [];
  return records.map((r: any) => ({
    date: r.created_at?.slice(0, 10) ?? null,
    recovery_score: r.score?.recovery_score ?? null,
    hrv_rmssd: r.score?.hrv_rmssd_milli ?? null,
    resting_hr: r.score?.resting_heart_rate ?? null,
    sleep_performance: r.score?.sleep_performance_percentage ?? null,
    raw: r,
  }));
}

async function getSleep(token: string): Promise<any[]> {
  const data = await whoopFetch("/activity/sleep?limit=7", token);
  const records = Array.isArray(data?.records) ? data.records : [];
  return records.map((s: any) => ({
    date: s.start?.slice(0, 10) ?? null,
    total_sleep_ms: s.score?.stage_summary?.total_in_bed_time_milli ?? null,
    sleep_hours: s.score?.stage_summary?.total_in_bed_time_milli
      ? Math.round((s.score.stage_summary.total_in_bed_time_milli / 3600000) * 100) / 100
      : null,
    sleep_efficiency: s.score?.sleep_efficiency_percentage ?? null,
    disturbances: s.score?.sleep_disturbances ?? null,
    stages: {
      light_ms: s.score?.stage_summary?.total_light_sleep_time_milli ?? null,
      slow_wave_ms: s.score?.stage_summary?.total_slow_wave_sleep_time_milli ?? null,
      rem_ms: s.score?.stage_summary?.total_rem_sleep_time_milli ?? null,
      awake_ms: s.score?.stage_summary?.total_awake_time_milli ?? null,
    },
    raw: s,
  }));
}

async function getStrain(token: string): Promise<any[]> {
  const data = await whoopFetch("/cycle?limit=7", token);
  const records = Array.isArray(data?.records) ? data.records : [];
  return records.map((c: any) => ({
    date: c.start?.slice(0, 10) ?? null,
    strain_score: c.score?.strain ?? null,
    kilojoules: c.score?.kilojoule ?? null,
    calories: c.score?.kilojoule ? Math.round((c.score.kilojoule / 4.184) * 10) / 10 : null,
    avg_hr: c.score?.average_heart_rate ?? null,
    max_hr: c.score?.max_heart_rate ?? null,
    raw: c,
  }));
}

async function getBiomarkers(token: string): Promise<any> {
  try {
    const data = await whoopFetch("/biomarker", token);
    return data ?? {};
  } catch (e: any) {
    // Biomarker endpoint may not be available on all WHOOP plans
    console.warn("[mavis-whoop-sync] biomarker fetch skipped:", e?.message);
    return { error: "Biomarker data unavailable on current WHOOP plan", details: e?.message };
  }
}

// ─────────────────────────────────────────────────────────────
// OAuth helper
// ─────────────────────────────────────────────────────────────

async function exchangeOAuthCode(
  code: string,
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<any> {
  const clientId     = Deno.env.get("WHOOP_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("WHOOP_CLIENT_SECRET") ?? "";
  const redirectUri  = Deno.env.get("WHOOP_REDIRECT_URI") ?? "";

  if (!clientId || !clientSecret) {
    throw new Error("WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET env vars not set");
  }

  const params = new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  redirectUri,
  });

  const tokenRes = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20000),
  });

  if (!tokenRes.ok) {
    throw new Error(`WHOOP OAuth token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const { error: upsertErr } = await supabase
    .from("whoop_tokens")
    .upsert({
      user_id:       userId,
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at:    expiresAt,
      scope:         tokenData.scope ?? null,
      updated_at:    new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (upsertErr) {
    throw new Error(`Failed to store WHOOP tokens: ${upsertErr.message}`);
  }

  return { connected: true, scope: tokenData.scope, expires_at: expiresAt };
}

// ─────────────────────────────────────────────────────────────
// Token lookup from DB
// ─────────────────────────────────────────────────────────────

async function resolveToken(
  requestToken: string | undefined,
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  if (requestToken?.trim()) return requestToken.trim();

  const { data, error } = await supabase
    .from("whoop_tokens")
    .select("access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data?.access_token) return null;
  return data.access_token;
}

function buildConnectUrl(): string {
  const clientId    = Deno.env.get("WHOOP_CLIENT_ID") ?? "";
  const redirectUri = Deno.env.get("WHOOP_REDIRECT_URI") ?? "";
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         "read:recovery read:sleep read:workout read:profile read:body_measurement",
  });
  return `https://api.prod.whoop.com/oauth/oauth2/auth?${params.toString()}`;
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

  let body: {
    action: string;
    user_id?: string;
    access_token?: string;
    code?: string;
    date?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { action, access_token: bodyToken, code, date } = body;
  const userId = user.id;

  // ── OAuth exchange ──
  if (action === "oauth_exchange") {
    if (!code) {
      return new Response(
        JSON.stringify({ error: "code is required for oauth_exchange" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    try {
      const result = await exchangeOAuthCode(code, supabase, userId);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e: any) {
      return new Response(
        JSON.stringify({ error: e?.message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // ── Resolve WHOOP token ──
  const token = await resolveToken(bodyToken, userId, supabase);

  if (!token) {
    return new Response(
      JSON.stringify({
        error: "WHOOP not connected",
        connect_url: buildConnectUrl(),
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Action dispatch ──
  try {
    switch (action) {
      case "get_recovery": {
        const recovery = await getRecovery(token);
        return new Response(
          JSON.stringify({ recovery }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "get_sleep": {
        const sleep = await getSleep(token);
        return new Response(
          JSON.stringify({ sleep }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "get_strain": {
        const strain = await getStrain(token);
        return new Response(
          JSON.stringify({ strain }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "get_biomarkers": {
        const biomarkers = await getBiomarkers(token);
        return new Response(
          JSON.stringify({ biomarkers }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      case "sync": {
        // Run all four in parallel; biomarkers may fail gracefully
        const [recovery, sleep, strain, biomarkers] = await Promise.all([
          getRecovery(token),
          getSleep(token),
          getStrain(token),
          getBiomarkers(token),
        ]);

        // Build upsert rows — merge by date
        const dateMap: Record<string, any> = {};

        for (const r of recovery) {
          if (!r.date) continue;
          dateMap[r.date] = dateMap[r.date] ?? { user_id: userId, date: r.date };
          dateMap[r.date].recovery_score    = r.recovery_score;
          dateMap[r.date].hrv_rmssd         = r.hrv_rmssd;
          dateMap[r.date].resting_hr        = r.resting_hr;
          dateMap[r.date].sleep_performance = r.sleep_performance;
          dateMap[r.date].raw_data          = { ...(dateMap[r.date].raw_data ?? {}), recovery: r.raw };
        }

        for (const s of sleep) {
          if (!s.date) continue;
          dateMap[s.date] = dateMap[s.date] ?? { user_id: userId, date: s.date };
          dateMap[s.date].sleep_hours = s.sleep_hours;
          dateMap[s.date].raw_data    = { ...(dateMap[s.date].raw_data ?? {}), sleep: s.raw };
        }

        for (const c of strain) {
          if (!c.date) continue;
          dateMap[c.date] = dateMap[c.date] ?? { user_id: userId, date: c.date };
          dateMap[c.date].strain_score = c.strain_score;
          dateMap[c.date].calories     = c.calories != null ? Math.round(c.calories) : null;
          dateMap[c.date].raw_data     = { ...(dateMap[c.date].raw_data ?? {}), strain: c.raw };
        }

        const biomarkersJson = Array.isArray(biomarkers) ? biomarkers : [biomarkers];
        for (const row of Object.values(dateMap)) {
          row.biomarkers = biomarkersJson;
          row.synced_at  = new Date().toISOString();
        }

        const upsertRows = Object.values(dateMap);

        if (upsertRows.length > 0) {
          const { error: upsertErr } = await supabase
            .from("whoop_daily_data")
            .upsert(upsertRows, { onConflict: "user_id,date" });

          if (upsertErr) {
            console.error("[mavis-whoop-sync] upsert error:", upsertErr.message);
            return new Response(
              JSON.stringify({ error: `Database upsert failed: ${upsertErr.message}` }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        return new Response(
          JSON.stringify({
            recovery,
            sleep,
            strain,
            biomarkers,
            synced_at: new Date().toISOString(),
            records_upserted: upsertRows.length,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      default:
        return new Response(
          JSON.stringify({
            error: `Unknown action: ${action}. Valid actions: sync, get_recovery, get_sleep, get_strain, get_biomarkers, oauth_exchange`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (e: any) {
    console.error("[mavis-whoop-sync] error:", e?.message);
    return new Response(
      JSON.stringify({ error: e?.message }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
