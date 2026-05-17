// MAVIS Transcribe
// Transcribes a voice memo (audio file stored in Supabase Storage) via OpenAI Whisper.
// Returns the transcript text and an estimated duration.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? "";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Rough word-count-based duration estimate.
 * Spoken English averages ~150 words per minute.
 */
function estimateDuration(transcript: string): number {
  const words = transcript.trim().split(/\s+/).length;
  return Math.round((words / 150) * 60); // seconds
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

  if (!OPENAI_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API key not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: { audio_url: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { audio_url, language = "en" } = body;

  if (!audio_url?.trim()) {
    return new Response(
      JSON.stringify({ error: "audio_url is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Fetch the audio file
  let audioBytes: ArrayBuffer;
  try {
    const audioRes = await fetch(audio_url, { signal: AbortSignal.timeout(30000) });
    if (!audioRes.ok) {
      throw new Error(`Failed to fetch audio (${audioRes.status})`);
    }
    audioBytes = await audioRes.arrayBuffer();
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: `Could not retrieve audio file: ${e?.message}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (audioBytes.byteLength === 0) {
    return new Response(
      JSON.stringify({ error: "Audio file is empty" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Determine MIME type from URL extension
  const urlLower = audio_url.toLowerCase().split("?")[0];
  let mimeType = "audio/webm";
  if (urlLower.endsWith(".mp3"))  mimeType = "audio/mpeg";
  else if (urlLower.endsWith(".mp4"))  mimeType = "audio/mp4";
  else if (urlLower.endsWith(".ogg"))  mimeType = "audio/ogg";
  else if (urlLower.endsWith(".wav"))  mimeType = "audio/wav";
  else if (urlLower.endsWith(".m4a"))  mimeType = "audio/m4a";
  else if (urlLower.endsWith(".flac")) mimeType = "audio/flac";

  const fileExtension = urlLower.split(".").pop() ?? "webm";
  const fileName = `recording.${fileExtension}`;

  // Build multipart form for Whisper
  const formData = new FormData();
  const audioBlob = new Blob([audioBytes], { type: mimeType });
  formData.append("file", audioBlob, fileName);
  formData.append("model", "whisper-1");
  formData.append("language", language);
  formData.append("response_format", "json");

  // Call OpenAI Whisper
  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: formData,
    signal: AbortSignal.timeout(60000),
  });

  if (!whisperRes.ok) {
    const errText = await whisperRes.text();
    console.error("[mavis-transcribe] Whisper error:", whisperRes.status, errText.slice(0, 300));
    return new Response(
      JSON.stringify({ error: `Transcription failed (${whisperRes.status})` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const whisperData = await whisperRes.json() as { text: string };
  const transcript  = whisperData.text ?? "";

  return new Response(
    JSON.stringify({
      transcript,
      duration_estimate: estimateDuration(transcript),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
