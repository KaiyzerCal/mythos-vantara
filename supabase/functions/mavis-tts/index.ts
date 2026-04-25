// ElevenLabs TTS for MAVIS, Council members, and Personas.
// Returns base64 MP3 in JSON so the client can play it with `data:audio/mpeg;base64,...`.

import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Default fallback voices (publicly available ElevenLabs voices)
const DEFAULT_MALE = "JBFqnCBsd6RMkjVDRZzb"; // George
const DEFAULT_FEMALE = "EXAVITQu4vr4xnSDxMaL"; // Sarah

function clean(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/:::ACTION[\s\S]*?:::/g, "")
    .replace(/\*[^*]+\*/g, "")
    .replace(/[#*_`>~]/g, "")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawText = String(body.text ?? "");
    const text = clean(rawText);
    if (!text) {
      return new Response(
        JSON.stringify({ error: "text required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const gender: "male" | "female" = body.gender === "female" ? "female" : "male";
    const voiceId =
      typeof body.voice_id === "string" && body.voice_id.length > 0
        ? body.voice_id
        : gender === "female"
        ? DEFAULT_FEMALE
        : DEFAULT_MALE;

    const settings = body.voice_settings ?? {};
    const stability = typeof settings.stability === "number" ? settings.stability : 0.5;
    const similarity = typeof settings.similarity_boost === "number" ? settings.similarity_boost : 0.75;
    const style = typeof settings.style === "number" ? settings.style : 0.3;
    const speed = typeof settings.speed === "number" ? Math.max(0.7, Math.min(1.2, settings.speed)) : 1.0;
    const model_id = typeof body.model_id === "string" ? body.model_id : "eleven_turbo_v2_5";

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
    const ttsRes = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id,
        voice_settings: {
          stability,
          similarity_boost: similarity,
          style,
          use_speaker_boost: true,
          speed,
        },
      }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      console.error("ElevenLabs TTS error", ttsRes.status, err);
      return new Response(
        JSON.stringify({ error: `TTS failed (${ttsRes.status})`, detail: err.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const buf = await ttsRes.arrayBuffer();
    const audioContent = base64Encode(buf);

    return new Response(
      JSON.stringify({ audioContent, mime: "audio/mpeg", voice_id: voiceId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("mavis-tts error", e?.message ?? e);
    return new Response(
      JSON.stringify({ error: e?.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
