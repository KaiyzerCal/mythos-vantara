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

// Strip markup, code, emojis, stage directions — anything a person wouldn't
// actually voice in a casual back-and-forth — and add light prosody cues so
// ElevenLabs delivers a relaxed, human-sounding read instead of a TTS recital.
function clean(text: string): string {
  let t = text
    // Remove fenced code blocks and inline code entirely
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    // Custom action tags should never be spoken
    .replace(/:::ACTION[\s\S]*?:::/g, "")
    .replace(/<[^>]+>/g, "")
    // Drop bracketed stage directions like *smiles*, _whispers_, (laughs)
    .replace(/\*[^*\n]+\*/g, "")
    .replace(/_[^_\n]+_/g, "")
    .replace(/\((?:laughs?|smiles?|sighs?|whispers?|chuckles?|grins?|pauses?)[^)]*\)/gi, "")
    // Markdown links → keep label text only
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Headings, list bullets, blockquotes, emphasis marks
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[#*_~>]/g, "")
    // Strip emoji / pictographs — they read as awkward names otherwise
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, "")
    // Common chat shorthands → spoken forms
    .replace(/\bw\/\b/gi, "with")
    .replace(/\bw\/o\b/gi, "without")
    .replace(/\b&\b/g, "and")
    // Ellipses → natural pause
    .replace(/\.{3,}/g, "…")
    // Em/en dashes → comma pause feels more conversational
    .replace(/\s*[—–]\s*/g, ", ")
    // Collapse whitespace, but preserve sentence breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Soft pause after sentence-ending punctuation for breathing room.
  t = t.replace(/([.!?])\s+(?=[A-Z0-9"'])/g, "$1  ");
  return t.slice(0, 4500);
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
    // Defaults tuned for natural, organic, human-feeling delivery:
    // lower stability = more expressive variation between phrases,
    // moderate style = personality without theatrics,
    // speaker boost on for clarity and presence.
    const stability = typeof settings.stability === "number" ? settings.stability : 0.35;
    const similarity = typeof settings.similarity_boost === "number" ? settings.similarity_boost : 0.78;
    const style = typeof settings.style === "number" ? settings.style : 0.45;
    const speed = typeof settings.speed === "number" ? Math.max(0.7, Math.min(1.2, settings.speed)) : 1.0;
    const use_speaker_boost = settings.use_speaker_boost !== false;
    // eleven_multilingual_v2 produces noticeably more lifelike, conversational
    // prosody than the turbo models — the small latency cost is worth it for
    // natural human-feeling speech.
    const model_id = typeof body.model_id === "string" ? body.model_id : "eleven_multilingual_v2";

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
        previous_text: typeof body.previous_text === "string" ? body.previous_text.slice(0, 500) : undefined,
        next_text: typeof body.next_text === "string" ? body.next_text.slice(0, 500) : undefined,
        voice_settings: {
          stability,
          similarity_boost: similarity,
          style,
          use_speaker_boost,
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
