// MAVIS Realtime v2 — OpenAI Realtime API v2 WebSocket proxy
// Reasoning-capable voice with multilingual translation support.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upgrade, connection",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const upgrade = req.headers.get("upgrade");

  // ── WebSocket proxy path ───────────────────────────────────────────────────
  if (upgrade?.toLowerCase() === "websocket") {
    const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

    // Auth check
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      clientWs.close(1008, "Unauthorized");
      return response;
    }

    if (!OPENAI_KEY) {
      clientWs.onopen = () => {
        clientWs.send(JSON.stringify({ type: "error", message: "OpenAI Realtime v2 not configured" }));
        clientWs.close(1011, "Not configured");
      };
      return response;
    }

    const url = new URL(req.url);
    const model = url.searchParams.get("model") ?? "gpt-4o-realtime-preview";
    const voice = url.searchParams.get("voice") ?? "alloy";
    const language = url.searchParams.get("language") ?? "en";

    // Connect to OpenAI Realtime v2
    const openaiWs = new WebSocket(`${OPENAI_REALTIME_URL}?model=${model}`, {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    openaiWs.onopen = () => {
      // Send session configuration
      openaiWs.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          voice,
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: { type: "server_vad", threshold: 0.5 },
          instructions: `You are MAVIS, a sovereign AI assistant. Language: ${language}. Be concise and helpful.`,
          temperature: 0.7,
          max_response_output_tokens: 4096,
        },
      }));
    };

    // Bidirectional proxy
    clientWs.onmessage = (e) => {
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(e.data);
    };
    openaiWs.onmessage = (e) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(e.data);
    };
    clientWs.onclose = () => openaiWs.close();
    openaiWs.onclose = () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    };
    openaiWs.onerror = (e) => {
      console.error("OpenAI WS error:", e);
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011, "Upstream error");
    };

    return response;
  }

  // ── Non-WebSocket: return connection info ──────────────────────────────────
  return new Response(
    JSON.stringify({
      configured: !!OPENAI_KEY,
      endpoint: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mavis-realtime-v2`,
      models: ["gpt-4o-realtime-preview", "gpt-4o-mini-realtime-preview"],
      voices: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
      features: ["streaming", "voice_activity_detection", "input_transcription", "multilingual"],
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
