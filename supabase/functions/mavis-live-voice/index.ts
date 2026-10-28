// MAVIS Live Voice — real-time bidirectional audio via Gemini Live API.
// Auth is done via first WebSocket message because browsers cannot send custom
// Authorization headers on WebSocket upgrade requests. verify_jwt is set to false
// in config.toml; we validate the Supabase token ourselves after WS connect.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { toGeminiFunctionDeclarations } from "../_shared/voiceTools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upgrade, connection",
};

const GEMINI_KEY   = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GEMINI_LIVE_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_KEY}`;

const VOICES = ["Aoede", "Charon", "Fenrir", "Kore", "Puck"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Upgrade WebSocket immediately — auth via first message.
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

  const url          = new URL(req.url);
  const systemPrompt = url.searchParams.get("system") ?? "You are MAVIS, a sovereign AI life OS.";
  const voiceName    = url.searchParams.get("voice") ?? "Aoede";

  let authenticated = false;
  let geminiWs: WebSocket | null = null;

  // 10-second window to authenticate before the connection is dropped.
  const authTimeout = setTimeout(() => {
    if (!authenticated && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: "error", message: "Authentication timeout" }));
      clientWs.close();
    }
  }, 10000);

  clientWs.onopen = () => {
    // Prompt the client to send its token.
    clientWs.send(JSON.stringify({ type: "auth_required" }));
  };

  clientWs.onmessage = async (event) => {
    try {
      const msg = JSON.parse(String(event.data));

      // ── Phase 1: authentication ────────────────────────────────────────────
      if (!authenticated) {
        if (msg.type !== "auth" || !msg.token) {
          clientWs.send(JSON.stringify({ type: "error", message: "First message must be { type: 'auth', token: '...' }" }));
          clientWs.close();
          return;
        }

        // Validate the Supabase JWT.
        const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
        const { data: { user }, error } = await sb.auth.getUser(msg.token);
        if (error || !user) {
          clientWs.send(JSON.stringify({ type: "error", message: "Invalid or expired token" }));
          clientWs.close();
          return;
        }

        clearTimeout(authTimeout);
        authenticated = true;

        if (!GEMINI_KEY) {
          clientWs.send(JSON.stringify({ type: "error", message: "GEMINI_API_KEY not configured on this server" }));
          clientWs.close();
          return;
        }

        // ── Connect to Gemini Live ───────────────────────────────────────────
        try {
          geminiWs = new WebSocket(GEMINI_LIVE_URL);
        } catch (e: any) {
          clientWs.send(JSON.stringify({ type: "error", message: `Gemini Live connection failed: ${e.message}` }));
          clientWs.close();
          return;
        }

        geminiWs.onopen = () => {
          geminiWs!.send(JSON.stringify({
            setup: {
              model: "models/gemini-2.0-flash-live-001",
              generation_config: {
                response_modalities: ["AUDIO"],
                speech_config: {
                  voice_config: {
                    prebuilt_voice_config: {
                      voice_name: VOICES.includes(voiceName as any) ? voiceName : "Aoede",
                    },
                  },
                },
              },
              // Was `tools: []` — this session could only talk, never create
              // or link a quest/skill no matter what the operator asked for.
              // msg.context carries a real skills/quests summary (with the
              // Beyonder tree + ids) built client-side by buildVoiceContext;
              // appended to the identity/persona prompt from the `system`
              // query param rather than replacing it.
              system_instruction: {
                parts: [{ text: msg.context ? `${systemPrompt}\n\n${msg.context}` : systemPrompt }],
              },
              tools: [{ function_declarations: toGeminiFunctionDeclarations() }],
            },
          }));
          clientWs.send(JSON.stringify({ type: "connected", provider: "gemini-live" }));
        };

        // ── Forward Gemini → Client ──────────────────────────────────────────
        geminiWs.onmessage = (gEvent) => {
          try {
            const gMsg = JSON.parse(String(gEvent.data));

            // Audio / text content
            const parts = gMsg?.serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) {
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

            // Turn / setup signals
            if (gMsg?.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ type: "turn_complete" }));
            }
            if (gMsg?.setupComplete) {
              clientWs.send(JSON.stringify({ type: "ready" }));
            }

            // Function calling — relay to the client, which executes through
            // the same actionExecutor → mavis-actions pipeline text chat and
            // the tap-to-speak overlay use, then sends a tool_result back
            // (forwarded to Gemini as toolResponse below).
            const calls = gMsg?.toolCall?.functionCalls;
            if (Array.isArray(calls) && calls.length > 0) {
              clientWs.send(JSON.stringify({
                type: "tool_call",
                calls: calls.map((c: any) => ({ id: c.id, name: c.name, args: c.args ?? {} })),
              }));
            }
          } catch { /* skip malformed */ }
        };

        geminiWs.onerror = () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "error", message: "Gemini Live stream error" }));
          }
        };

        geminiWs.onclose = () => {
          if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        };

        return;
      }

      // ── Phase 2: authenticated — forward Client → Gemini ──────────────────
      if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN) return;

      if (msg.type === "audio_chunk" && msg.data) {
        geminiWs.send(JSON.stringify({
          realtime_input: {
            media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: msg.data }],
          },
        }));
      } else if (msg.type === "text" && msg.content) {
        geminiWs.send(JSON.stringify({
          client_content: {
            turns: [{ role: "user", parts: [{ text: msg.content }] }],
            turn_complete: true,
          },
        }));
      } else if (msg.type === "interrupt") {
        // Signal Gemini to stop its current turn.
        geminiWs.send(JSON.stringify({ client_content: { turns: [], turn_complete: true } }));
      } else if (msg.type === "tool_result" && Array.isArray(msg.responses)) {
        geminiWs.send(JSON.stringify({
          tool_response: {
            function_responses: msg.responses.map((r: any) => ({ id: r.id, name: r.name, response: r.response ?? {} })),
          },
        }));
      }
    } catch { /* skip malformed messages */ }
  };

  clientWs.onclose = () => {
    clearTimeout(authTimeout);
    if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close();
  };

  return response;
});
