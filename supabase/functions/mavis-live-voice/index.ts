// MAVIS Live Voice — real-time bidirectional audio via Gemini Live API.
// Auth is done via first WebSocket message because browsers cannot send custom
// Authorization headers on WebSocket upgrade requests. verify_jwt is set to false
// in config.toml; we validate the Supabase token ourselves after WS connect.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { toGeminiFunctionDeclarations, toOpenAIRealtimeTools } from "../_shared/voiceTools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upgrade, connection",
};

const GEMINI_KEY   = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GEMINI_LIVE_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_KEY}`;

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_REALTIME_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL") ?? "gpt-4o-realtime-preview";

// Client streams 16 kHz PCM16 (Gemini's rate); OpenAI Realtime wants 24 kHz.
function upsample16to24(b64: string): string {
  const bin = atob(b64);
  const inBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) inBytes[i] = bin.charCodeAt(i);
  const inp = new Int16Array(inBytes.buffer, 0, Math.floor(inBytes.length / 2));
  const outLen = Math.floor(inp.length * 3 / 2);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * 2 / 3, j = Math.floor(pos), f = pos - j;
    const a = inp[j] ?? 0, b = inp[j + 1] ?? a;
    out[i] = a + (b - a) * f;
  }
  const ob = new Uint8Array(out.buffer);
  let s = "";
  for (let i = 0; i < ob.length; i += 0x8000) s += String.fromCharCode(...ob.subarray(i, i + 0x8000));
  return btoa(s);
}

const VOICES = ["Aoede", "Charon", "Fenrir", "Kore", "Puck"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Upgrade WebSocket immediately — auth via first message.
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

  const url          = new URL(req.url);
  const systemPrompt = url.searchParams.get("system") ?? "You are MAVIS, a sovereign AI life OS.";
  const voiceName    = url.searchParams.get("voice") ?? "Aoede";
  // Fallback chain is driven by the client: gemini first, then provider=openai.
  const provider     = url.searchParams.get("provider") === "openai" ? "openai" : "gemini";
  let openaiWs: WebSocket | null = null;

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

        if (provider === "openai") {
          if (!OPENAI_KEY) {
            clientWs.send(JSON.stringify({ type: "error", fallback: true, message: "OPENAI_API_KEY not configured" }));
            clientWs.close();
            return;
          }
          try {
            openaiWs = new WebSocket(
              `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_MODEL}`,
              ["realtime", `openai-insecure-api-key.${OPENAI_KEY}`, "openai-beta.realtime-v1"],
            );
          } catch (e: any) {
            clientWs.send(JSON.stringify({ type: "error", fallback: true, message: `OpenAI live voice failed: ${e.message}` }));
            clientWs.close();
            return;
          }
          const instructions = msg.context ? `${systemPrompt}\n\n${msg.context}` : systemPrompt;
          openaiWs.onopen = () => {
            openaiWs!.send(JSON.stringify({
              type: "session.update",
              session: {
                modalities: ["audio", "text"],
                instructions,
                voice: "shimmer",
                input_audio_format: "pcm16",
                output_audio_format: "pcm16",
                turn_detection: { type: "server_vad" },
                tools: toOpenAIRealtimeTools(),
              },
            }));
            clientWs.send(JSON.stringify({ type: "connected", provider: "openai-realtime" }));
          };
          openaiWs.onmessage = (oEvent) => {
            try {
              const m = JSON.parse(String(oEvent.data));
              switch (m.type) {
                case "session.updated": clientWs.send(JSON.stringify({ type: "ready", provider: "openai-realtime" })); break;
                case "response.audio.delta": clientWs.send(JSON.stringify({ type: "audio", mimeType: "audio/pcm;rate=24000", data: m.delta })); break;
                case "response.audio_transcript.delta": clientWs.send(JSON.stringify({ type: "text", content: m.delta })); break;
                case "response.done": clientWs.send(JSON.stringify({ type: "turn_complete" })); break;
                case "response.function_call_arguments.done": {
                  let args = {};
                  try { args = JSON.parse(m.arguments || "{}"); } catch { /* keep empty */ }
                  clientWs.send(JSON.stringify({ type: "tool_call", calls: [{ id: m.call_id, name: m.name, args }] }));
                  break;
                }
                case "error": console.warn(`[live-voice] OpenAI error: ${JSON.stringify(m.error).slice(0, 300)}`); break;
              }
            } catch { /* skip malformed */ }
          };
          openaiWs.onclose = (ev) => {
            console.warn(`[live-voice] OpenAI Realtime closed ${ev.code}: ${String(ev.reason).slice(0, 200)}`);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: "error", fallback: true, message: `OpenAI live voice unavailable (${ev.code})` }));
              clientWs.close();
            }
          };
          return;
        }

        if (!GEMINI_KEY) {
          clientWs.send(JSON.stringify({ type: "error", fallback: true, message: "GEMINI_API_KEY not configured on this server" }));
          clientWs.close();
          return;
        }

        // ── Connect to Gemini Live ───────────────────────────────────────────
        try {
          geminiWs = new WebSocket(GEMINI_LIVE_URL);
        } catch (e: any) {
          clientWs.send(JSON.stringify({ type: "error", fallback: true, message: `Gemini Live connection failed: ${e.message}` }));
          clientWs.close();
          return;
        }

        geminiWs.onopen = () => {
          geminiWs!.send(JSON.stringify({
            setup: {
              model: `models/${Deno.env.get("GEMINI_LIVE_MODEL") ?? "gemini-2.5-flash-native-audio-preview-09-2025"}`,
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
        geminiWs.onmessage = async (gEvent) => {
          try {
            // Gemini Live sends binary frames; decode before parsing.
            const raw = typeof gEvent.data === "string"
              ? gEvent.data
              : gEvent.data instanceof Blob
                ? await gEvent.data.text()
                : new TextDecoder().decode(gEvent.data as ArrayBuffer);
            const gMsg = JSON.parse(raw);

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
            clientWs.send(JSON.stringify({ type: "error", fallback: true, message: "Gemini Live stream error" }));
          }
        };

        geminiWs.onclose = (ev) => {
          console.warn(`[live-voice] Gemini Live closed ${ev.code}: ${String(ev.reason).slice(0, 200)}`);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "error", fallback: true, message: `Live voice unavailable (${ev.code}${ev.reason ? `: ${String(ev.reason).slice(0, 120)}` : ""})` }));
            clientWs.close();
          }
        };

        return;
      }

      // ── Phase 2 (OpenAI): forward Client → OpenAI Realtime ────────────────
      if (provider === "openai") {
        if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
        if (msg.type === "audio_chunk" && msg.data) {
          openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: upsample16to24(msg.data) }));
        } else if (msg.type === "text" && msg.content) {
          openaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: msg.content }] } }));
          openaiWs.send(JSON.stringify({ type: "response.create" }));
        } else if (msg.type === "interrupt") {
          openaiWs.send(JSON.stringify({ type: "response.cancel" }));
        } else if (msg.type === "tool_result" && Array.isArray(msg.responses)) {
          for (const r of msg.responses) {
            openaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: r.id, output: JSON.stringify(r.response ?? {}) } }));
          }
          openaiWs.send(JSON.stringify({ type: "response.create" }));
        }
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
    if (openaiWs?.readyState === WebSocket.OPEN) openaiWs.close();
  };

  return response;
});
