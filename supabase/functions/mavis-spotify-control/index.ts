// MAVIS Spotify Control
// Full playback control via Spotify Web API (Premium required).
// Actions: now_playing | play | pause | skip | previous | volume | shuffle | repeat | devices | transfer | queue | search

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
  if (!data.access_token) throw new Error("Spotify token refresh failed");
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

async function spotifyApi(
  token: string,
  method: string,
  path: string,
  body?: object,
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`https://api.spotify.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 204) return { ok: true, status: 204, data: null };
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSb = createClient(supabaseUrl, serviceKey);

    // Auth: Bearer JWT or TELEGRAM_OPERATOR_USER_ID env fallback
    let uid: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const { data: { user } } = await adminSb.auth.getUser(authHeader.slice(7));
      uid = user?.id ?? null;
    }
    if (!uid) uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
    if (!uid) return json({ error: "Unauthorized" }, 401);

    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", uid)
      .eq("provider", "spotify")
      .single();

    if (!integration?.config) {
      return json({ error: "Spotify not connected. Add OAuth credentials in Integrations." });
    }

    const token = await refreshSpotifyToken(integration.config, adminSb, uid);
    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "now_playing";

    // ── Actions ───────────────────────────────────────────────────────────

    if (action === "now_playing") {
      const r = await spotifyApi(token, "GET", "/v1/me/player");
      if (r.status === 204 || !r.data?.item) return json({ playing: false, message: "Nothing is currently playing." });
      const t = r.data.item;
      return json({
        playing: r.data.is_playing,
        track: t.name,
        artists: t.artists?.map((a: any) => a.name).join(", "),
        album: t.album?.name,
        progress_ms: r.data.progress_ms,
        duration_ms: t.duration_ms,
        device: r.data.device?.name,
        volume: r.data.device?.volume_percent,
        shuffle: r.data.shuffle_state,
        repeat: r.data.repeat_state,
        track_url: t.external_urls?.spotify,
      });
    }

    if (action === "play") {
      const query: string | undefined = body.query;
      const qType: string = body.type ?? "track"; // track | artist | album | playlist
      const deviceId: string | undefined = body.device_id;
      let playBody: object | undefined;

      if (query) {
        const searchType = qType === "artist" ? "artist"
          : qType === "album" ? "album"
          : qType === "playlist" ? "playlist"
          : "track";
        const sr = await spotifyApi(token, "GET", `/v1/search?q=${encodeURIComponent(query)}&type=${searchType}&limit=1`);
        if (!sr.ok) throw new Error(`Spotify search failed: ${sr.data?.error?.message ?? sr.status}`);

        if (searchType === "track") {
          const uri = sr.data.tracks?.items?.[0]?.uri;
          if (!uri) return json({ error: `No track found for "${query}"` });
          playBody = { uris: [uri] };
        } else if (searchType === "artist") {
          const artistId = sr.data.artists?.items?.[0]?.id;
          if (!artistId) return json({ error: `No artist found for "${query}"` });
          // Play top tracks so shuffle over artist works well
          const topR = await spotifyApi(token, "GET", `/v1/artists/${artistId}/top-tracks?market=US`);
          const uris = (topR.data?.tracks ?? []).slice(0, 10).map((t: any) => t.uri);
          playBody = uris.length ? { uris } : { context_uri: `spotify:artist:${artistId}` };
        } else if (searchType === "album") {
          const uri = sr.data.albums?.items?.[0]?.uri;
          if (!uri) return json({ error: `No album found for "${query}"` });
          playBody = { context_uri: uri };
        } else if (searchType === "playlist") {
          const uri = sr.data.playlists?.items?.[0]?.uri;
          if (!uri) return json({ error: `No playlist found for "${query}"` });
          playBody = { context_uri: uri };
        }
      }

      const qs = deviceId ? `?device_id=${deviceId}` : "";
      const r = await spotifyApi(token, "PUT", `/v1/me/player/play${qs}`, playBody);
      if (!r.ok) {
        const msg = r.data?.error?.message ?? "Playback failed";
        if (r.status === 403) throw new Error(`${msg} — Spotify Premium required for playback control.`);
        if (r.status === 404) throw new Error("No active Spotify device. Open Spotify on any device first, then retry.");
        throw new Error(msg);
      }
      return json({ ok: true, message: query ? `Playing "${query}"` : "Playback resumed" });
    }

    if (action === "pause") {
      const r = await spotifyApi(token, "PUT", "/v1/me/player/pause");
      if (!r.ok && r.status !== 403) throw new Error(r.data?.error?.message ?? "Pause failed");
      return json({ ok: true, message: "Paused" });
    }

    if (action === "skip" || action === "next") {
      const r = await spotifyApi(token, "POST", "/v1/me/player/next");
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Skip failed");
      return json({ ok: true, message: "Skipped to next track" });
    }

    if (action === "previous" || action === "back") {
      const r = await spotifyApi(token, "POST", "/v1/me/player/previous");
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Previous track failed");
      return json({ ok: true, message: "Went to previous track" });
    }

    if (action === "volume") {
      const percent = Math.max(0, Math.min(100, Number(body.percent ?? body.volume ?? 50)));
      const r = await spotifyApi(token, "PUT", `/v1/me/player/volume?volume_percent=${percent}`);
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Volume change failed");
      return json({ ok: true, message: `Volume set to ${percent}%` });
    }

    if (action === "shuffle") {
      const enabled = body.enabled !== false;
      const r = await spotifyApi(token, "PUT", `/v1/me/player/shuffle?state=${enabled}`);
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Shuffle toggle failed");
      return json({ ok: true, message: `Shuffle ${enabled ? "on" : "off"}` });
    }

    if (action === "repeat") {
      const mode: string = body.mode ?? "context"; // off | track | context
      const r = await spotifyApi(token, "PUT", `/v1/me/player/repeat?state=${mode}`);
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Repeat mode change failed");
      return json({ ok: true, message: `Repeat: ${mode}` });
    }

    if (action === "devices") {
      const r = await spotifyApi(token, "GET", "/v1/me/player/devices");
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Failed to list devices");
      const devices = (r.data?.devices ?? []).map((d: any) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        is_active: d.is_active,
        volume_percent: d.volume_percent,
      }));
      return json({ devices });
    }

    if (action === "transfer") {
      const deviceId: string = body.device_id;
      if (!deviceId) throw new Error("device_id is required for transfer");
      const r = await spotifyApi(token, "PUT", "/v1/me/player", {
        device_ids: [deviceId],
        play: body.play !== false,
      });
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Transfer failed");
      return json({ ok: true, message: "Playback transferred" });
    }

    if (action === "queue") {
      const uri: string = body.uri;
      if (!uri) throw new Error("uri is required for queue");
      const r = await spotifyApi(token, "POST", `/v1/me/player/queue?uri=${encodeURIComponent(uri)}`);
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Add to queue failed");
      return json({ ok: true, message: "Added to queue" });
    }

    if (action === "search") {
      const q: string = body.query ?? body.q ?? "";
      if (!q) throw new Error("query is required");
      const types = body.types ?? "track,artist,album,playlist";
      const limit = Math.min(Number(body.limit ?? 5), 20);
      const r = await spotifyApi(token, "GET", `/v1/search?q=${encodeURIComponent(q)}&type=${types}&limit=${limit}`);
      if (!r.ok) throw new Error(r.data?.error?.message ?? "Search failed");
      // Simplify response
      const results: Record<string, any[]> = {};
      if (r.data.tracks?.items) results.tracks = r.data.tracks.items.map((t: any) => ({ name: t.name, artist: t.artists?.[0]?.name, uri: t.uri, url: t.external_urls?.spotify }));
      if (r.data.artists?.items) results.artists = r.data.artists.items.map((a: any) => ({ name: a.name, uri: a.uri, url: a.external_urls?.spotify }));
      if (r.data.albums?.items) results.albums = r.data.albums.items.map((a: any) => ({ name: a.name, artist: a.artists?.[0]?.name, uri: a.uri, url: a.external_urls?.spotify }));
      if (r.data.playlists?.items) results.playlists = r.data.playlists.items.filter(Boolean).map((p: any) => ({ name: p.name, owner: p.owner?.display_name, uri: p.uri, url: p.external_urls?.spotify }));
      return json({ results });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
