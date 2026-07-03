// mavis-multi-provider — OpenClaude-powered unified provider gateway
// Accepts user-configured API keys and routes to the correct transport.
//
// Supports transport kinds from KaiyzerCal/openclaude:
//   anthropic-native   → api.anthropic.com (native SDK format)
//   openai-compatible  → any OpenAI-compat base URL (OpenAI, DeepSeek, Groq, Mistral, xAI, …)
//   gemini-native      → generativelanguage.googleapis.com
//   local              → Ollama (OpenAI-compat on localhost — not callable from Supabase edge;
//                        falls back with informative error)
//
// POST body:
//   action  : "chat" | "test"
//   provider: "anthropic" | "openai" | "gemini" | "deepseek" | "groq" | "mistral" |
//             "xai" | "fireworks" | "openrouter" | "ollama"
//   transport: "anthropic-native" | "openai-compatible" | "gemini-native" | "local"
//   apiKey  : string  (user's personal key — never stored server-side)
//   baseUrl : string  (provider base URL)
//   model   : string
//   messages: { role: "user"|"assistant", content: string }[]
//   system? : string
//   max_tokens?: number
//
// Returns: { content, model, provider, transport, usage? } or { ok, error }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function verifyAuth(req: Request): Promise<boolean> {
  const auth  = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return false;
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (token === svcKey) return true;
  const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!supaUrl) return false;
  try {
    const res = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: svcKey },
    });
    return res.ok;
  } catch { return false; }
}

// ── Transport: Anthropic native ────────────────────────────────────────────────

async function callAnthropic(body: any): Promise<{ content: string; usage?: any }> {
  const { apiKey, baseUrl, model, messages, system, max_tokens = 1024 } = body;
  const key  = apiKey || Deno.env.get("ANTHROPIC_API_KEY") || "";
  const base = (baseUrl || "https://api.anthropic.com").replace(/\/$/, "");

  const payload: any = { model, max_tokens, messages };
  if (system) payload.system = system;

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Anthropic ${res.status}`);
  const content = data.content?.[0]?.text ?? "";
  return { content, usage: data.usage };
}

// ── Transport: OpenAI-compatible ───────────────────────────────────────────────

async function callOpenAICompat(body: any): Promise<{ content: string; usage?: any }> {
  const { apiKey, baseUrl, model, messages, system, max_tokens = 1024 } = body;
  const base = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");

  const msgs: any[] = [];
  if (system) msgs.push({ role: "system", content: system });
  msgs.push(...messages);

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages: msgs, max_tokens }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Provider ${res.status}`);
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content, usage: data.usage };
}

// ── Transport: Gemini native ───────────────────────────────────────────────────

async function callGemini(body: any): Promise<{ content: string; usage?: any }> {
  const { apiKey, baseUrl, model, messages, system, max_tokens = 1024 } = body;
  const key  = apiKey || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "";
  const base = (baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");

  // Convert messages to Gemini format
  const contents = messages.map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const payload: any = {
    contents,
    generationConfig: { maxOutputTokens: max_tokens },
  };
  if (system) {
    payload.systemInstruction = { parts: [{ text: system }] };
  }

  const res = await fetch(`${base}/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Gemini ${res.status}`);
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const usage   = data.usageMetadata;
  return { content, usage };
}

// ── Test message per provider ──────────────────────────────────────────────────

const TEST_MESSAGE = [{ role: "user", content: "Reply with exactly: OK" }];

async function handleTest(body: any): Promise<Response> {
  const { transport, provider } = body;

  if (transport === "local") {
    // Ollama runs on localhost — not reachable from Supabase edge network.
    // The browser can test this directly; just confirm the format is correct.
    return ok({ ok: true, note: "Ollama runs locally — connection tested client-side." });
  }

  try {
    let result: { content: string };
    const testBody = { ...body, messages: TEST_MESSAGE, max_tokens: 20, system: "You are a test responder." };
    if (transport === "anthropic-native") result = await callAnthropic(testBody);
    else if (transport === "gemini-native") result = await callGemini(testBody);
    else result = await callOpenAICompat(testBody);

    return ok({ ok: true, provider, transport, preview: result.content.slice(0, 80) });
  } catch (e: any) {
    return ok({ ok: false, error: e?.message ?? "Unknown error" });
  }
}

// ── Chat ───────────────────────────────────────────────────────────────────────

async function handleChat(body: any): Promise<Response> {
  const { transport, provider, model } = body;

  if (!transport) return err("transport required");
  if (!model)     return err("model required");

  if (transport === "local") {
    return err("Ollama (local) is not reachable from the Supabase edge network. Call Ollama directly from the browser or desktop app.", 400);
  }

  try {
    let result: { content: string; usage?: any };
    if (transport === "anthropic-native") result = await callAnthropic(body);
    else if (transport === "gemini-native") result = await callGemini(body);
    else result = await callOpenAICompat(body);

    return ok({ content: result.content, model, provider, transport, usage: result.usage });
  } catch (e: any) {
    return err(e?.message ?? "Provider error", 502);
  }
}

// ── Models discovery (for Ollama) ─────────────────────────────────────────────

async function handleModels(body: any): Promise<Response> {
  const { baseUrl } = body;
  const base = (baseUrl || "http://localhost:11434").replace(/\/$/, "");
  // Only useful for local fetch from browser — edge can't reach localhost
  return ok({ models: [], note: "Model discovery for local providers must be done client-side." });
}

// ── Main ───────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await verifyAuth(req))) return err("Unauthorized", 401);

  let body: any = {};
  try { body = await req.json(); } catch { return err("Invalid JSON", 400); }

  const action = body.action ?? "chat";

  if (action === "test")   return handleTest(body);
  if (action === "chat")   return handleChat(body);
  if (action === "models") return handleModels(body);

  return err(`Unknown action: ${action}`);
});
