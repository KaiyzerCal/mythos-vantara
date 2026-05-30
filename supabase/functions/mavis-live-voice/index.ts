const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upgrade, connection",
};

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_LIVE_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_KEY}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Validate auth
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const systemPrompt = new URL(req.url).searchParams.get("system") ?? "You are MAVIS, a sovereign AI assistant.";

  // Upgrade to WebSocket
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

  clientWs.onopen = async () => {
    if (!GEMINI_KEY) {
      clientWs.send(JSON.stringify({ error: "GEMINI_API_KEY not configured" }));
      clientWs.close();
      return;
    }

    // Connect to Gemini Live API
    let geminiWs: WebSocket;
    try {
      geminiWs = new WebSocket(GEMINI_LIVE_URL);
    } catch (e: any) {
      clientWs.send(JSON.stringify({ error: `Gemini Live WS failed: ${e.message}` }));
      clientWs.close();
      return;
    }

    geminiWs.onopen = () => {
      // Send setup message to Gemini Live
      geminiWs.send(JSON.stringify({
        setup: {
          model: "models/gemini-2.0-flash-live-001",
          generation_config: {
            response_modalities: ["AUDIO"],
            speech_config: {
              voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } },
            },
          },
          system_instruction: { parts: [{ text: systemPrompt }] },
          tools: [],
        },
      }));
      clientWs.send(JSON.stringify({ type: "connected", provider: "gemini-live" }));
    };

    // Forward Gemini responses to client
    geminiWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Audio chunks: forward raw base64 audio to client
        const audioParts = msg?.serverContent?.modelTurn?.parts ?? [];
        for (const part of audioParts) {
          if (part.inlineData?.mimeType?.startsWith("audio/")) {
            clientWs.send(JSON.stringify({
              type: "audio",
              mimeType: part.inlineData.mimeType,
              data: part.inlineData.data,
            }));
          }
          if (part.text) {
            clientWs.send(JSON.stringify({ type: "text", content: part.text }));
          }
        }
        // Turn complete signal
        if (msg?.serverContent?.turnComplete) {
          clientWs.send(JSON.stringify({ type: "turn_complete" }));
        }
        // Setup complete
        if (msg?.setupComplete) {
          clientWs.send(JSON.stringify({ type: "ready" }));
        }
      } catch { /* skip malformed */ }
    };

    geminiWs.onerror = (e) => {
      clientWs.send(JSON.stringify({ type: "error", message: "Gemini Live connection error" }));
    };

    geminiWs.onclose = () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    };

    // Forward client audio to Gemini
    clientWs.onmessage = (event) => {
      if (geminiWs.readyState !== WebSocket.OPEN) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "audio_chunk" && msg.data) {
          // Client sends PCM16 base64 audio chunks
          geminiWs.send(JSON.stringify({
            realtime_input: {
              media_chunks: [{
                mime_type: "audio/pcm;rate=16000",
                data: msg.data,
              }],
            },
          }));
        } else if (msg.type === "text") {
          // Text turn input
          geminiWs.send(JSON.stringify({
            client_content: {
              turns: [{ role: "user", parts: [{ text: msg.content }] }],
              turn_complete: true,
            },
          }));
        } else if (msg.type === "interrupt") {
          // User interrupted — stop current generation
          geminiWs.send(JSON.stringify({ client_content: { turns: [], turn_complete: true } }));
        }
      } catch { /* skip */ }
    };

    clientWs.onclose = () => {
      if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    };
  };

  return response;
});
