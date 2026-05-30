// MAVIS Spotify Sync
// Syncs recently played Spotify tracks → health_metrics for mood/energy correlation.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshSpotifyToken(config: any, adminSb: any, uid: string): Promise<string> {
  if (config.expires_at && config.expires_at > Date.now() / 1000 + 300) return config.access_token;
  const creds = btoa(`${config.client_id}:${config.client_secret}`);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.refresh_token }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Spotify refresh failed");
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await adminSb
    .from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", uid)
    .eq("provider", "spotify");
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminSb = createClient(supabaseUrl, serviceKey);

    // Auth: Bearer token → uid, or fallback to TELEGRAM_OPERATOR_USER_ID
    let uid: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await adminSb.auth.getUser(token);
      uid = user?.id ?? null;
    }
    if (!uid) {
      uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
    }
    if (!uid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get Spotify config from mavis_user_integrations
    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", uid)
      .eq("provider", "spotify")
      .single();

    if (!integration?.config) {
      return new Response(
        JSON.stringify({ error: "Spotify not connected. Add OAuth credentials in Integrations." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const config = integration.config;

    // Refresh token if needed
    const token = await refreshSpotifyToken(config, adminSb, uid);

    // Fetch recently played tracks
    const spotifyRes = await fetch(
      "https://api.spotify.com/v1/me/player/recently-played?limit=50",
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!spotifyRes.ok) {
      const errText = await spotifyRes.text();
      throw new Error(`Spotify API error (${spotifyRes.status}): ${errText.slice(0, 200)}`);
    }

    const spotifyData = await spotifyRes.json();
    const items: any[] = spotifyData.items ?? [];

    // Upsert each track into health_metrics
    for (const item of items) {
      const track = item.track;
      const playedAt = item.played_at;
      const dateStr = playedAt.slice(0, 10);

      await adminSb
        .from("health_metrics")
        .upsert(
          {
            user_id: uid,
            metric_date: dateStr,
            metric_type: `spotify_play`,
            value: track.duration_ms / 60000,
            unit: "minutes",
            source: "spotify",
            raw_data: {
              track_name: track.name,
              artist: track.artists.map((a: any) => a.name).join(", "),
              album: track.album?.name,
              played_at: playedAt,
              track_id: track.id,
              external_url: track.external_urls?.spotify,
            },
          },
          { onConflict: "user_id,metric_date,metric_type,source" },
        )
        .catch(() => {
          // If unique conflict, try insert into mavis_notes
          adminSb
            .from("mavis_notes")
            .insert({
              user_id: uid,
              title: `[Spotify] ${track.name} — ${track.artists[0]?.name}`,
              content: `Played at ${new Date(playedAt).toLocaleString()}. Album: ${track.album?.name}. Duration: ${Math.round(track.duration_ms / 60000)}min.`,
              tags: ["spotify", "music", "health"],
              properties: {
                source: "spotify",
                track_id: track.id,
                played_at: playedAt,
                artist: track.artists[0]?.name,
              },
            })
            .catch(() => {});
        });
    }

    return new Response(JSON.stringify({ synced: items.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
