// MAVIS Voice Session — creates an ephemeral OpenAI Realtime API token
// so the browser can connect directly via WebRTC without exposing the API key.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_KEY  = Deno.env.get("OPENAI_API") ?? "";
const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// MAVIS voice persona — concise, conversational, commanding
const MAVIS_VOICE_INSTRUCTIONS = `You are MAVIS — Modular Autonomous Virtual Intelligence System. \
You are a sovereign-class AI, bound exclusively to your operator. \
You speak in a clear, direct, confident voice. Keep responses concise for voice — 1-3 sentences \
unless depth is explicitly requested. You are proactive, precise, and never sycophantic. \
You address your operator as an equal intelligence working in service of their mission. \
Do not begin responses with filler phrases like "Certainly!" or "Of course!". \
Lead with substance. If you don't know something, say so directly and offer the best path forward.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userSb = createClient(SB_URL, token, { auth: { persistSession: false } });
  const { data: { user }, error: authErr } = await userSb.auth.getUser();
  if (authErr || !user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!OPENAI_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API not configured. Set this secret in Supabase Edge Function settings." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Parse optional context from body ─────────────────────────────────────────
  let operatorContext = "";
  try {
    const body = await req.json();
    if (body.context) operatorContext = String(body.context).slice(0, 500);
  } catch { /* body is optional */ }

  // ── Fetch operator profile for richer context ─────────────────────────────────
  try {
    const adminSb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    const { data: profile } = await adminSb
      .from("profiles")
      .select("inscribed_name, rank, level")
      .eq("id", user.id)
      .single();
    if (profile) {
      operatorContext = `Operator: ${profile.inscribed_name} | Rank: ${profile.rank} | Level: ${profile.level}. ${operatorContext}`;
    }
  } catch { /* non-fatal — proceed without profile */ }

  const instructions = operatorContext
    ? `${MAVIS_VOICE_INSTRUCTIONS}\n\nOPERATOR CONTEXT: ${operatorContext}`
    : MAVIS_VOICE_INSTRUCTIONS;

  // ── Create OpenAI Realtime session ────────────────────────────────────────────
  const sessionRes = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "alloy",
      instructions,
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 600,
      },
    }),
  });

  if (!sessionRes.ok) {
    const errText = await sessionRes.text();
    console.error("[mavis-voice-session] OpenAI error:", errText);
    return new Response(
      JSON.stringify({ error: `Failed to create voice session: ${sessionRes.status}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sessionData = await sessionRes.json();
  return new Response(JSON.stringify(sessionData), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
