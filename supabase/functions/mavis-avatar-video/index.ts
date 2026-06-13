// mavis-avatar-video
// Talking-head pipeline: face image + script → ElevenLabs TTS → fal.ai SadTalker → lip-synced video

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FAL_KEY = Deno.env.get("FAL_API_KEY") ?? "";
const ELEVENLABS_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const FAL_MODEL = "fal-ai/sadtalker";

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

// ── fal.ai SadTalker ─────────────────────────────────────────────────────────

async function submitJob(
  source_image_url: string,
  driven_audio_url: string,
  still_mode: boolean,
  use_enhancer: boolean,
): Promise<string> {
  if (!FAL_KEY) throw new Error("FAL_API_KEY not configured");

  const res = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: { "Authorization": `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      source_image_url,
      driven_audio_url,
      preprocess: "crop",
      still_mode,
      use_enhancer,
      size_of_image: 512,
      expression_scale: 1.0,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai submit failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.request_id) throw new Error("fal.ai returned no request_id");
  return data.request_id;
}

async function pollJob(request_id: string): Promise<{ status: string; url?: string }> {
  if (!FAL_KEY) throw new Error("FAL_API_KEY not configured");

  const res = await fetch(`https://queue.fal.run/${FAL_MODEL}/${request_id}`, {
    headers: { "Authorization": `Key ${FAL_KEY}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai poll failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();

  if (data.status === "COMPLETED" || data.video?.url) {
    const url = data.video?.url ?? data.output?.video?.url;
    if (!url) throw new Error("Job completed but no video URL in response");
    return { status: "complete", url };
  }

  if (data.status === "FAILED" || data.error) {
    throw new Error(`fal.ai job failed: ${data.error ?? "unknown error"}`);
  }

  return { status: "processing" };
}

// ── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json();
    const {
      action,
      request_id,
      source_image_url,
      audio_url,
      text,
      voice_id,
      still_mode = false,
      use_enhancer = true,
    } = body;

    // ── Poll ──────────────────────────────────────────────────────────────────
    if (action === "poll") {
      if (!request_id) return json({ error: "request_id required for poll" }, 400);
      const result = await pollJob(request_id);
      return json(result);
    }

    // ── Generate ──────────────────────────────────────────────────────────────
    if (!source_image_url) return json({ error: "source_image_url required" }, 400);
    if (!audio_url && !text) return json({ error: "Either audio_url or text required" }, 400);

    // Step 1: get audio URL (generate via TTS if only text given)
    const finalAudioUrl: string = audio_url
      ? audio_url
      : await textToAudioUrl(String(text), voice_id ?? "JBFqnCBsd6RMkjVDRZzb");

    // Step 2: submit to fal.ai SadTalker
    const rid = await submitJob(source_image_url, finalAudioUrl, !!still_mode, !!use_enhancer);

    return json({ status: "processing", request_id: rid, provider: "fal/sadtalker" });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("mavis-avatar-video error:", message);
    return json({ error: message }, 500);
  }
});
