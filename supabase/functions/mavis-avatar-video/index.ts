// mavis-avatar-video
// Talking-head pipeline: script → lip-synced avatar video
//
// Provider hierarchy (best quality → fallback):
//   heygen    — HeyGen API (HEYGEN_API_KEY) — commercial grade, $29/mo Creator plan
//   hallo2    — fal-ai/hallo2 (FAL_API_KEY) — open-source but very high quality, ~$0.20/video
//   sadtalker — fal-ai/sadtalker (FAL_API_KEY) — legacy fallback, lower quality
//
// HeyGen setup: https://app.heygen.com/settings?nav=API
//   Set HEYGEN_API_KEY in Supabase secrets vault.
//   provider:"heygen" requires an explicit avatar_id/heygen_voice_id/userId —
//   there is no default avatar. List avatars via mavis-heygen-agent's
//   list_avatars action, or GET https://api.heygen.com/v2/avatars directly.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FAL_KEY       = Deno.env.get("FAL_API_KEY")       ?? "";
const HEYGEN_KEY    = Deno.env.get("HEYGEN_API_KEY")    ?? "";
const ELEVENLABS_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")      ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const FAL_MODEL_HALLO2    = "fal-ai/hallo2";
const FAL_MODEL_SADTALKER = "fal-ai/sadtalker";

// ── HeyGen ───────────────────────────────────────────────────────────────────
// Delegates to mavis-heygen-agent — the one place in the codebase that talks
// to api.heygen.com directly — instead of duplicating that HTTP client here.

async function submitHeyGenJob(
  userId: string,
  text: string,
  avatarId: string,
  voiceId: string,
  width: number,
  height: number,
): Promise<{ status: string; requestId: string; url?: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-heygen-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({
      userId, action: "generate_video",
      avatar_id: avatarId, voice_id: voiceId, text,
      width, height,
      // Single quick check, not a full poll loop — this call must return
      // fast since it's serving a synchronous HTTP request; the caller
      // polls separately via action=poll&provider=heygen afterward.
      max_attempts: 1, poll_interval_ms: 1000,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error ?? `HeyGen submit ${res.status}`);
  if (!data.video_id) throw new Error("HeyGen returned no video_id");
  return { status: data.completed ? "complete" : "processing", requestId: data.video_id, url: data.video_url };
}

async function pollHeyGenJob(userId: string, videoId: string): Promise<{ status: string; url?: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-heygen-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ userId, action: "get_video_status", video_id: videoId }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error ?? `HeyGen poll ${res.status}`);
  if (data.status === "failed") throw new Error(`HeyGen video failed: ${data.status}`);
  return data.completed ? { status: "complete", url: data.video_url } : { status: "processing" };
}

// ── Hallo2 (fal.ai — much better than SadTalker) ─────────────────────────────

async function submitHallo2Job(
  source_image_url: string,
  driven_audio_url: string,
): Promise<string> {
  const res = await fetch(`https://queue.fal.run/${FAL_MODEL_HALLO2}`, {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      portrait_image_url: source_image_url,
      audio_url: driven_audio_url,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Hallo2 submit ${res.status}: ${await res.text().then(t => t.slice(0, 300))}`);
  const data = await res.json();
  if (!data.request_id) throw new Error("Hallo2 returned no request_id");
  return data.request_id;
}

async function pollHallo2Job(request_id: string): Promise<{ status: string; url?: string }> {
  const res = await fetch(`https://queue.fal.run/${FAL_MODEL_HALLO2}/${request_id}`, {
    headers: { "Authorization": `Key ${FAL_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Hallo2 poll ${res.status}`);
  const data = await res.json();
  if (data.status === "COMPLETED" || data.video?.url) {
    const url = data.video?.url ?? data.output?.video?.url;
    return { status: "complete", url };
  }
  if (data.status === "FAILED") throw new Error("Hallo2 job failed");
  return { status: "processing" };
}

// ── TTS → storage URL ────────────────────────────────────────────────────────

async function textToAudioUrl(text: string, voiceId: string): Promise<string> {
  if (!ELEVENLABS_KEY) throw new Error("ELEVENLABS_API_KEY not configured");

  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.78, style: 0.3, use_speaker_boost: true },
      }),
    },
  );

  if (!ttsRes.ok) {
    const err = await ttsRes.text();
    throw new Error(`TTS failed (${ttsRes.status}): ${err.slice(0, 200)}`);
  }

  const audioBuffer = await ttsRes.arrayBuffer();
  const fileName = `avatar-audio/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.mp3`;

  const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error: uploadErr } = await adminSb.storage
    .from("voice-memos")
    .upload(fileName, audioBuffer, { contentType: "audio/mpeg", upsert: true });

  if (uploadErr) throw new Error(`Audio upload failed: ${uploadErr.message}`);

  const { data: { publicUrl } } = adminSb.storage.from("voice-memos").getPublicUrl(fileName);
  return publicUrl;
}

// ── SadTalker (legacy fal.ai fallback) ───────────────────────────────────────

async function submitSadTalkerJob(
  source_image_url: string,
  driven_audio_url: string,
  still_mode: boolean,
  use_enhancer: boolean,
): Promise<string> {
  const res = await fetch(`https://queue.fal.run/${FAL_MODEL_SADTALKER}`, {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source_image_url, driven_audio_url, preprocess: "crop", still_mode, use_enhancer, size_of_image: 512, expression_scale: 1.0 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`SadTalker submit ${res.status}: ${await res.text().then(t => t.slice(0, 300))}`);
  const data = await res.json();
  if (!data.request_id) throw new Error("SadTalker returned no request_id");
  return data.request_id;
}

async function pollSadTalkerJob(request_id: string): Promise<{ status: string; url?: string }> {
  const res = await fetch(`https://queue.fal.run/${FAL_MODEL_SADTALKER}/${request_id}`, {
    headers: { "Authorization": `Key ${FAL_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`SadTalker poll ${res.status}`);
  const data = await res.json();
  if (data.status === "COMPLETED" || data.video?.url) {
    const url = data.video?.url ?? data.output?.video?.url;
    return { status: "complete", url };
  }
  if (data.status === "FAILED" || data.error) throw new Error(`SadTalker failed: ${data.error ?? "unknown"}`);
  return { status: "processing" };
}

// ── Handler ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      action,
      request_id,
      provider: requestedProvider,
      userId,
      source_image_url,
      audio_url,
      text,
      voice_id,
      still_mode = false,
      use_enhancer = true,
      // HeyGen-specific — required, never defaulted to a stock avatar
      avatar_id,
      heygen_voice_id,
      width = 1280,
      height = 720,
    } = body;

    // ── Poll path ─────────────────────────────────────────────────────────────
    // provider must be explicit — silently defaulting to hallo2 meant a
    // HeyGen job polled through the wrong provider's poller and just spun.
    if (action === "poll") {
      if (!request_id) return json({ error: "request_id required for poll" }, 400);
      if (!requestedProvider) return json({ error: "provider required for poll" }, 400);
      if (requestedProvider === "heygen") {
        if (!userId) return json({ error: "userId required for HeyGen poll" }, 400);
        return json(await pollHeyGenJob(String(userId), String(request_id)));
      }
      if (requestedProvider === "hallo2") return json(await pollHallo2Job(String(request_id)));
      if (requestedProvider === "sadtalker") return json(await pollSadTalkerJob(String(request_id)));
      return json({ error: `unknown provider: ${requestedProvider}` }, 400);
    }

    // ── HeyGen path (text only, no image needed) ──────────────────────────────
    // Only entered when explicitly requested — previously this silently
    // fired for EVERY request whenever HEYGEN_API_KEY happened to be
    // configured, ignoring the caller's uploaded photo/voice and using a
    // hardcoded stock avatar instead.
    if (requestedProvider === "heygen") {
      if (!HEYGEN_KEY) return json({ error: "HEYGEN_API_KEY not configured" }, 503);
      if (!text?.trim()) return json({ error: "text required for HeyGen" }, 400);
      if (!userId) return json({ error: "userId required for HeyGen" }, 400);
      if (!avatar_id) return json({ error: "avatar_id required for HeyGen" }, 400);
      if (!heygen_voice_id) return json({ error: "heygen_voice_id required for HeyGen" }, 400);
      const result = await submitHeyGenJob(String(userId), String(text), avatar_id, heygen_voice_id, width, height);
      return json({ status: result.status, request_id: result.requestId, provider: "heygen", avatar_id, url: result.url, note: "Poll with action=poll&provider=heygen" });
    }

    // ── Hallo2 / SadTalker path (image + audio) ───────────────────────────────
    if (!source_image_url) return json({ error: "source_image_url required (or set HEYGEN_API_KEY for text-only avatar)" }, 400);
    if (!audio_url && !text) return json({ error: "Either audio_url or text is required" }, 400);
    if (!FAL_KEY) return json({ error: "FAL_API_KEY not configured" }, 503);

    const finalAudioUrl: string = audio_url
      ? audio_url
      : await textToAudioUrl(String(text), voice_id ?? "JBFqnCBsd6RMkjVDRZzb");

    // Try Hallo2 first (much better quality than SadTalker)
    if (requestedProvider !== "sadtalker") {
      try {
        const rid = await submitHallo2Job(source_image_url, finalAudioUrl);
        return json({ status: "processing", request_id: rid, provider: "hallo2" });
      } catch (err) {
        console.warn("Hallo2 failed, falling back to SadTalker:", err instanceof Error ? err.message : err);
      }
    }

    const rid = await submitSadTalkerJob(source_image_url, finalAudioUrl, !!still_mode, !!use_enhancer);
    return json({ status: "processing", request_id: rid, provider: "sadtalker" });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("mavis-avatar-video error:", message);
    return json({ error: message }, 500);
  }
});
