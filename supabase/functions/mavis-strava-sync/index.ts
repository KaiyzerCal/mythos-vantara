import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const uid = user.id;

  let body: { days?: number } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional
  }

  const days = body.days ?? 7;

  // 1. Read Strava tokens from mavis_user_integrations
  const { data: integRow, error: integErr } = await supabase
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", uid)
    .eq("provider", "strava")
    .maybeSingle();

  if (integErr || !integRow?.config) {
    return new Response(
      JSON.stringify({ error: "Strava not connected. Add OAuth credentials in Integrations." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const config = integRow.config as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    client_id: string;
    client_secret: string;
  };

  let { access_token, refresh_token, expires_at, client_id, client_secret } = config;

  // 3. Token refresh if expiring within 5 minutes
  if (expires_at < Date.now() / 1000 + 300) {
    try {
      const refreshRes = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id,
          client_secret,
          grant_type: "refresh_token",
          refresh_token,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!refreshRes.ok) {
        const errText = await refreshRes.text();
        throw new Error(`Token refresh failed (${refreshRes.status}): ${errText.slice(0, 200)}`);
      }

      const refreshData = await refreshRes.json() as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      };

      access_token = refreshData.access_token;
      refresh_token = refreshData.refresh_token;
      expires_at = refreshData.expires_at;

      // Persist updated tokens
      await supabase
        .from("mavis_user_integrations")
        .update({
          config: { ...config, access_token, refresh_token, expires_at },
        })
        .eq("user_id", uid)
        .eq("provider", "strava");
    } catch (e: any) {
      return new Response(
        JSON.stringify({ error: `Strava token refresh failed: ${e?.message}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // 4. Fetch activities
  const after = Math.floor((Date.now() - days * 86400000) / 1000);

  let activities: any[] = [];
  try {
    const activitiesRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=50`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!activitiesRes.ok) {
      const errText = await activitiesRes.text();
      throw new Error(`Strava API error (${activitiesRes.status}): ${errText.slice(0, 200)}`);
    }

    activities = await activitiesRes.json() as any[];
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: `Failed to fetch Strava activities: ${e?.message}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!Array.isArray(activities)) {
    activities = [];
  }

  // 5. Upsert health_metrics
  if (activities.length > 0) {
    const rows = activities.map((activity) => ({
      user_id: uid,
      metric_date: activity.start_date_local.slice(0, 10),
      metric_type: `strava_${(activity.sport_type ?? activity.type ?? "activity").toLowerCase()}`,
      value: Math.round((activity.distance ?? 0) / 1000 * 10) / 10,
      unit: "km",
      source: "strava",
      raw_data: {
        id: activity.id,
        name: activity.name,
        type: activity.type,
        sport_type: activity.sport_type,
        distance_m: activity.distance,
        moving_time_s: activity.moving_time,
        start_date: activity.start_date_local,
      },
    }));

    const { error: upsertErr } = await supabase
      .from("health_metrics")
      .upsert(rows, { onConflict: "user_id,metric_date,metric_type,source" });

    if (upsertErr) {
      console.error("[mavis-strava-sync] upsert error:", upsertErr.message);
      if (upsertErr.message?.includes("does not exist") || upsertErr.code === "42P01") {
        return new Response(
          JSON.stringify({ error: "health_metrics table does not exist. Run the latest migration." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: `Database upsert failed: ${upsertErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // 6. Award XP for runs > 1km
  let totalXp = 0;
  const runs = activities.filter((a) => {
    const km = Math.round((a.distance ?? 0) / 1000 * 10) / 10;
    return km > 1;
  });

  if (runs.length > 0) {
    const xpFromRuns = runs.reduce((sum, a) => {
      const km = Math.round((a.distance ?? 0) / 1000 * 10) / 10;
      return sum + Math.floor(km * 10);
    }, 0);

    const { data: profileData } = await supabase
      .from("profiles")
      .select("xp")
      .eq("id", uid)
      .single();

    if (profileData) {
      const currentXp = profileData.xp ?? 0;
      totalXp = xpFromRuns;
      await supabase
        .from("profiles")
        .update({ xp: currentXp + xpFromRuns })
        .eq("id", uid);
    }
  }

  return new Response(
    JSON.stringify({ synced: activities.length, xp_awarded: totalXp }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
