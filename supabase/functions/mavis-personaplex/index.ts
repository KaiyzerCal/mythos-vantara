// MAVIS PersonaPlex — NVIDIA PersonaPlex-7B persona voice synthesis
// Full-duplex persona TTS via NVIDIA NIM (170ms TTFA, any character).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NVIDIA_KEY = Deno.env.get("NVIDIA_API_KEY") ?? "";
const PERSONAPLEX_BASE = "https://integrate.api.nvidia.com/v1";

// MAVIS-specific persona voice presets
const PERSONA_VOICES: Record<string, string> = {
  "mavis_sovereign": "A commanding, intelligent female voice with slight futuristic quality",
  "mavis_reflect":   "Warm, empathetic, thoughtful — for journal/reflect mode",
  "mavis_quest":     "Energetic, motivating — for quest and challenge modes",
  "mavis_arch":      "Analytical, precise — for ARCH/CODEX modes",
  "custom":          "User-defined voice characteristics",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!NVIDIA_KEY) {
    return new Response(
      JSON.stringify({ error: "NVIDIA PersonaPlex not configured", configured: false }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: {
    text?: string;
    voice_persona?: string;
    emotion?: string;
    speaking_rate?: number;
    pitch?: number;
    format?: "mp3" | "wav" | "pcm";
    stream?: boolean;
    action?: string;
    audio_sample_base64?: string;
    voice_name?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { action } = body;

  // ── Voice cloning endpoint ─────────────────────────────────────────────────
  if (action === "clone_voice") {
    const { audio_sample_base64, voice_name } = body;
    if (!audio_sample_base64 || !voice_name) {
      return new Response(
        JSON.stringify({ error: "audio_sample_base64 and voice_name are required for clone_voice" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cloneRes = await fetch(`${PERSONAPLEX_BASE}/audio/voices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NVIDIA_KEY}`,
      },
      body: JSON.stringify({
        model: "nvidia/personaplex-7b",
        name: voice_name,
        audio: audio_sample_base64,
      }),
    });

    if (!cloneRes.ok) {
      const errText = await cloneRes.text();
      return new Response(
        JSON.stringify({ error: "NVIDIA voice cloning failed", details: errText }),
        { status: cloneRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cloneData = await cloneRes.json();
    return new Response(
      JSON.stringify({ success: true, voice: cloneData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Standard TTS synthesis ─────────────────────────────────────────────────
  const { text, voice_persona, speaking_rate, format, stream } = body;

  if (!text?.trim()) {
    return new Response(
      JSON.stringify({ error: "text is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const personaId = voice_persona ?? "mavis_sovereign";

  const nimBody = {
    model: "nvidia/personaplex-7b",
    input: text.slice(0, 4096),
    voice: personaId,
    response_format: format ?? "mp3",
    speed: speaking_rate ?? 1.0,
  };

  const res = await fetch(`${PERSONAPLEX_BASE}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NVIDIA_KEY}`,
    },
    body: JSON.stringify(nimBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    return new Response(
      JSON.stringify({ error: "NVIDIA PersonaPlex TTS failed", details: errText }),
      { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Streaming response ─────────────────────────────────────────────────────
  if (stream) {
    const contentType = res.headers.get("Content-Type") ?? "audio/mpeg";
    return new Response(res.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Transfer-Encoding": "chunked",
      },
    });
  }

  // ── Buffered response — return audio bytes directly ────────────────────────
  const audioBytes = await res.arrayBuffer();
  const mimeType = format === "wav" ? "audio/wav" : format === "pcm" ? "audio/pcm" : "audio/mpeg";

  return new Response(audioBytes, {
    headers: {
      ...corsHeaders,
      "Content-Type": mimeType,
      "X-Persona": personaId,
      "X-Persona-Description": PERSONA_VOICES[personaId] ?? "Custom persona voice",
    },
  });
});
