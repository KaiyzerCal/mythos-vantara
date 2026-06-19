// mavis-spotify-agent
// Spotify playback controller: search, queue, skip, resume, pause, volume, shuffle, now-playing.
// Includes play_from_text: Claude extracts track/artist from natural language →
//   Spotify search → add to queue → skip to it → resume → return "Now playing …"
// Mirrors n8n: Telegram trigger → OpenAI extract → Spotify search → If found →
//   Add to queue → Next song → Resume play → Currently playing → Reply.
//
// Actions:
//   search | search_track | add_to_queue | next_song | previous_song
//   resume_play | pause | currently_playing | get_devices | transfer_playback
//   get_playlists | set_volume | set_shuffle | start_context | play_from_text
//
// Auth: store Spotify credentials in mavis_user_integrations (provider='spotify')
//   config: { access_token, refresh_token, expires_at }
// Requires: SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET for token refresh
//           ANTHROPIC_API_KEY for play_from_text

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL            = Deno.env.get("SUPABASE_URL")!;
const SB_SRK            = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY     = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID") ?? "";
const SPOTIFY_SECRET    = Deno.env.get("SPOTIFY_CLIENT_SECRET") ?? "";
const SPOTIFY_API       = "https://api.spotify.com/v1";

// ── Token management ──────────────────────────────────────────────────────────

async function refreshToken(config: Record<string, unknown>, sb: ReturnType<typeof createClient>, uid: string): Promise<string> {
  const refresh = String(config.refresh_token ?? "");
  if (!refresh) throw new Error("No Spotify refresh_token stored — re-authorise via OAuth");
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_SECRET) throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not configured");

  const creds = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_SECRET}`);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Basic ${creds}` },
    body:    `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`,
    signal:  AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Spotify token refresh failed: ${data.error_description ?? data.error}`);

  const newAccess  = String(data.access_token);
  const newRefresh = String(data.refresh_token ?? refresh);
  const expiresAt  = Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000;

  await sb.from("mavis_user_integrations").upsert(
    { user_id: uid, provider: "spotify", config: { ...config, access_token: newAccess, refresh_token: newRefresh, expires_at: expiresAt } },
    { onConflict: "user_id,provider" },
  );
  return newAccess;
}

async function getToken(sb: ReturnType<typeof createClient>, uid: string): Promise<string> {
  const { data, error } = await sb.from("mavis_user_integrations")
    .select("config").eq("user_id", uid).eq("provider", "spotify").single();
  if (error || !data) throw new Error("Spotify not connected. Add credentials to mavis_user_integrations (provider='spotify')");
  const cfg = data.config as Record<string, unknown>;
  if (Number(cfg.expires_at ?? 0) > Date.now()) return String(cfg.access_token ?? "");
  return refreshToken(cfg, sb, uid);
}

// ── Spotify request helper ────────────────────────────────────────────────────

type SpotifyResponse = { ok: boolean; status: number; data: unknown };

async function sp(token: string, method: string, path: string, body?: Record<string, unknown> | null): Promise<SpotifyResponse> {
  const res = await fetch(`${SPOTIFY_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 204) return { ok: true, status: 204, data: null };
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function spotifyErr(r: SpotifyResponse, label: string): never {
  throw new Error(`${label}: ${(r.data as any)?.error?.message ?? `HTTP ${r.status}`}`);
}

// ── Claude track extractor ────────────────────────────────────────────────────

async function extractTrackInfo(text: string): Promise<{ track: string; artist: string }> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{
        role:    "user",
        content: `Extract the artist and song name from this request: "${text}"\nReply ONLY in this exact format:\ntrack:song name\nartist:artist name\nIf you cannot determine one, leave it blank after the colon.`,
      }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`Claude error: ${JSON.stringify(d?.error).slice(0, 100)}`);
  const out    = String(d.content?.[0]?.text ?? "");
  const track  = out.match(/track:(.*)/i)?.[1]?.trim()  ?? "";
  const artist = out.match(/artist:(.*)/i)?.[1]?.trim() ?? "";
  return { track, artist };
}

// ── Track/item shape helper ───────────────────────────────────────────────────

function fmtTrack(t: any) {
  return {
    id:          t?.id,
    uri:         t?.uri,
    name:        t?.name,
    artists:     t?.artists?.map((a: any) => a.name) ?? [],
    album:       t?.album?.name,
    duration_ms: t?.duration_ms,
    preview_url: t?.preview_url ?? null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body       = await req.json().catch(() => ({}));
    const adminSb    = createClient(SB_URL, SB_SRK);
    const authHeader = req.headers.get("Authorization") ?? "";

    let uid: string;
    if (authHeader === `Bearer ${SB_SRK}`) {
      uid = String(body.userId ?? body.user_id ?? "").trim();
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);
    } else if (authHeader.startsWith("Bearer ")) {
      const { data: { user }, error } = await adminSb.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      uid = user.id;
    } else {
      return json({ error: "Unauthorized" }, 401);
    }

    const action = String(body.action ?? "currently_playing");
    const token  = await getToken(adminSb, uid);

    switch (action) {

      // ── Search ──────────────────────────────────────────────────────────────

      case "search":
      case "search_track": {
        const query  = String(body.query ?? body.q ?? "");
        const type   = String(body.type ?? "track");          // track|playlist|artist|album
        const limit  = Math.min(Number(body.limit ?? 5), 50);
        if (!query) return json({ error: "query required" }, 400);

        const r = await sp(token, "GET", `/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`);
        if (!r.ok) spotifyErr(r, "Search failed");

        const d = r.data as any;
        if (type === "track")    return json({ tracks:    (d.tracks?.items    ?? []).map(fmtTrack) });
        if (type === "playlist") return json({ playlists: (d.playlists?.items ?? []).map((p: any) => ({ id: p.id, uri: p.uri, name: p.name, tracks: p.tracks?.total, owner: p.owner?.display_name })) });
        if (type === "artist")   return json({ artists:   (d.artists?.items   ?? []).map((a: any) => ({ id: a.id, uri: a.uri, name: a.name, genres: a.genres, followers: a.followers?.total })) });
        if (type === "album")    return json({ albums:    (d.albums?.items    ?? []).map((a: any) => ({ id: a.id, uri: a.uri, name: a.name, artists: a.artists?.map((x: any) => x.name), release_date: a.release_date })) });
        return json(d);
      }

      // ── Queue ───────────────────────────────────────────────────────────────

      case "add_to_queue": {
        const uri      = String(body.uri ?? "");
        const track_id = String(body.track_id ?? body.id ?? "");
        const qUri     = uri || (track_id ? `spotify:track:${track_id}` : "");
        if (!qUri) return json({ error: "uri or track_id required" }, 400);
        const r = await sp(token, "POST", `/me/player/queue?uri=${encodeURIComponent(qUri)}`);
        if (!r.ok) spotifyErr(r, "Add to queue failed");
        return json({ queued: true, uri: qUri });
      }

      // ── Playback controls ────────────────────────────────────────────────────

      case "next_song": {
        const r = await sp(token, "POST", "/me/player/next");
        if (!r.ok) spotifyErr(r, "Next song failed");
        return json({ skipped: true });
      }

      case "previous_song": {
        const r = await sp(token, "POST", "/me/player/previous");
        if (!r.ok) spotifyErr(r, "Previous song failed");
        return json({ rewound: true });
      }

      case "resume_play": {
        const r = await sp(token, "PUT", "/me/player/play");
        // 403 = Spotify returns this when playback is already active on a different device or already playing — not a real error
        if (!r.ok && r.status !== 403) spotifyErr(r, "Resume play failed");
        return json({ playing: true });
      }

      case "pause": {
        const r = await sp(token, "PUT", "/me/player/pause");
        if (!r.ok) spotifyErr(r, "Pause failed");
        return json({ paused: true });
      }

      case "set_volume": {
        const pct = Math.min(100, Math.max(0, Number(body.percent ?? body.volume ?? 50)));
        const r   = await sp(token, "PUT", `/me/player/volume?volume_percent=${pct}`);
        if (!r.ok) spotifyErr(r, "Set volume failed");
        return json({ volume_percent: pct });
      }

      case "set_shuffle": {
        const state = body.enabled !== false && body.state !== false;
        const r     = await sp(token, "PUT", `/me/player/shuffle?state=${state}`);
        if (!r.ok) spotifyErr(r, "Set shuffle failed");
        return json({ shuffle: state });
      }

      case "start_context": {
        // Start playing a playlist, album, or artist context URI
        const context_uri = String(body.context_uri ?? body.uri ?? "");
        const offset      = body.offset_position != null ? { position: Number(body.offset_position) } : undefined;
        if (!context_uri) return json({ error: "context_uri required (e.g. spotify:playlist:xxx)" }, 400);
        const playBody: Record<string, unknown> = { context_uri };
        if (offset) playBody.offset = offset;
        const r = await sp(token, "PUT", "/me/player/play", playBody);
        if (!r.ok && r.status !== 403) spotifyErr(r, "Start context failed");
        return json({ playing: true, context_uri });
      }

      // ── State ────────────────────────────────────────────────────────────────

      case "currently_playing": {
        const r = await sp(token, "GET", "/me/player/currently-playing");
        if (r.status === 204) return json({ playing: false, message: "Nothing is currently playing" });
        if (!r.ok) spotifyErr(r, "Currently playing failed");
        const d    = r.data as any;
        const item = d.item;
        return json({
          playing:     d.is_playing,
          name:        item?.name,
          artists:     item?.artists?.map((a: any) => a.name) ?? [],
          album:       item?.album?.name,
          uri:         item?.uri,
          progress_ms: d.progress_ms,
          duration_ms: item?.duration_ms,
          message:     item ? `Now playing ${item.name} - ${item.artists?.[0]?.name} - ${item.album?.name}` : "Nothing playing",
        });
      }

      case "get_devices": {
        const r = await sp(token, "GET", "/me/player/devices");
        if (!r.ok) spotifyErr(r, "Get devices failed");
        return json({ devices: (r.data as any).devices ?? [] });
      }

      case "transfer_playback": {
        const device_id = String(body.device_id ?? "");
        if (!device_id) return json({ error: "device_id required" }, 400);
        const r = await sp(token, "PUT", "/me/player", { device_ids: [device_id], play: body.play !== false });
        if (!r.ok) spotifyErr(r, "Transfer playback failed");
        return json({ transferred: true, device_id });
      }

      case "get_playlists": {
        const limit = Math.min(Number(body.limit ?? 20), 50);
        const r     = await sp(token, "GET", `/me/playlists?limit=${limit}`);
        if (!r.ok) spotifyErr(r, "Get playlists failed");
        return json({
          playlists: ((r.data as any).items ?? []).map((p: any) => ({
            id: p.id, uri: p.uri, name: p.name, tracks: p.tracks?.total, owner: p.owner?.display_name,
          })),
        });
      }

      // ── play_from_text — full n8n pipeline ─────────────────────────────────

      case "play_from_text": {
        // 1. Claude extracts artist + song name from natural language
        // 2. Spotify search (track only) — limit 1
        // 3. If not found → return "Song not found"
        // 4. Add to queue → skip to it (next_song) → resume play → get currently playing → return
        const text = String(body.text ?? body.message ?? body.query ?? "");
        if (!text) return json({ error: "text required" }, 400);

        const { track, artist } = await extractTrackInfo(text);
        const searchQuery = [track, artist].filter(Boolean).join(" ");
        if (!searchQuery) return json({ error: "Could not extract song info from text", text }, 400);

        // 2. Search
        const searchR = await sp(token, "GET", `/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=1`);
        const found   = searchR.ok ? ((searchR.data as any).tracks?.items?.[0] ?? null) : null;

        if (!found) {
          return json({ found: false, query: searchQuery, extracted: { track, artist }, message: `Song not found: "${searchQuery}"` });
        }

        const trackUri = String(found.uri);

        // 3. Add to queue
        const qRes = await sp(token, "POST", `/me/player/queue?uri=${encodeURIComponent(trackUri)}`);
        if (!qRes.ok) {
          return json({ found: true, queued: false, error: (qRes.data as any)?.error?.message ?? `HTTP ${qRes.status}`, track: found.name, artist: found.artists?.[0]?.name });
        }

        // 4. Skip to next (plays the just-queued song)
        const nextR = await sp(token, "POST", "/me/player/next");
        if (!nextR.ok) {
          return json({ found: true, queued: true, skipped: false, error: (nextR.data as any)?.error?.message ?? `HTTP ${nextR.status}` });
        }

        // 5. Resume (no-op if already playing)
        await sp(token, "PUT", "/me/player/play");

        // 6. Brief pause then confirm currently playing
        await new Promise(r => setTimeout(r, 800));
        const nowR  = await sp(token, "GET", "/me/player/currently-playing");
        const nowItem = (nowR.status !== 204 && nowR.ok) ? (nowR.data as any)?.item : null;

        const message = nowItem
          ? `Now playing ${nowItem.name} - ${nowItem.artists?.[0]?.name} - ${nowItem.album?.name}`
          : `Playing ${found.name} - ${found.artists?.[0]?.name}`;

        return json({
          found:     true,
          queued:    true,
          skipped:   true,
          message,
          track:     nowItem?.name   ?? found.name,
          artists:   (nowItem?.artists ?? found.artists)?.map((a: any) => a.name),
          album:     nowItem?.album?.name ?? found.album?.name,
          uri:       trackUri,
          extracted: { track, artist, query: searchQuery },
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: search | add_to_queue | next_song | previous_song | resume_play | pause | currently_playing | get_devices | transfer_playback | get_playlists | set_volume | set_shuffle | start_context | play_from_text`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-spotify-agent]", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
