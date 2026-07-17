// mavis-llm-router — Centralized LLM routing with free-Gemini-first cascade.
//
// POST { model?, task_type?, system, messages, max_tokens? }
//   model      — specific model name (e.g. "claude-sonnet-4-6", "gpt-4o-mini")
//                or "mavis-choice" to skip to the smart cascade
//   task_type  — hint for MAVIS Choice: "chat"|"simple"|"complex"|"reasoning"|
//                "code"|"search"|"realtime". Defaults to "chat".
//   system     — system prompt string
//   messages   — [{ role: "user"|"assistant", content: string }]
//   max_tokens — default 1200
//
// Returns { content, model_used, provider, cost_usd }
//
// Cascade order:
//   1. gemini-2.0-flash      (free tier, 15 RPM)
//   2. gemini-2.0-flash-lite (free tier, 30 RPM, separate quota)
//   3. Explicit model's native provider (if caller specified one)
//   4. MAVIS Choice by task_type:
//      search/realtime  → grok-3-mini → gpt-4o-mini
//      code/debug       → claude-sonnet → gpt-4o
//      complex/reasoning→ gemini-2.5-flash → claude-sonnet → gpt-4o
//      default/chat     → claude-haiku → gpt-4o-mini → grok-3-mini

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY")    ?? Deno.env.get("GOOGLE_API_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY    = Deno.env.get("OPENAI_API")        ?? Deno.env.get("OPENAI_API_KEY") ?? "";
const XAI_KEY       = Deno.env.get("XAI_API_KEY")       ?? Deno.env.get("GROK_API_KEY")   ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Circuit breaker (module-level — survives warm Deno isolate) ─────────────
const _unhealthyUntil = new Map<string, number>();
function isUnhealthy(key: string): boolean {
  const t = _unhealthyUntil.get(key);
  return t !== undefined && Date.now() < t;
}
function markUnhealthy(key: string, ttlMs = 120_000): void {
  _unhealthyUntil.set(key, Date.now() + ttlMs);
}

// ── Cost table (USD per 1M tokens, 4 chars ≈ 1 token) ──────────────────────
const RATES: Record<string, [number, number]> = {
  "gemini-2.0-flash":           [0.0,  0.0 ],
  "gemini-2.0-flash-lite":      [0.0,  0.0 ],
  "gemini-2.5-flash":           [0.075, 0.30],
  "gemini-2.5-thinking":        [3.5,  10.5 ],
  "claude-haiku-4-5-20251001":  [0.25,  1.25],
  "claude-sonnet-4-6":          [3.0,  15.0 ],
  "gpt-4o-mini":                [0.15,  0.60],
  "gpt-4o":                     [2.5,  10.0 ],
  "grok-3-mini":                [0.30,  0.50],
};
function estimateCost(model: string, inputChars: number, outputChars: number): number {
  const key = model.startsWith("gemini-2.0") ? model :
              model.startsWith("gemini-2.5") && model.includes("thinking") ? "gemini-2.5-thinking" :
              model.startsWith("gemini-2.5") ? "gemini-2.5-flash" :
              RATES[model] ? model : "gpt-4o-mini";
  const [inR, outR] = RATES[key] ?? [0.15, 0.60];
  const inTok  = inputChars  / 4;
  const outTok = outputChars / 4;
  return Math.round(((inTok * inR + outTok * outR) / 1_000_000) * 1_000_000) / 1_000_000;
}

// ── Error types ─────────────────────────────────────────────────────────────
class ProviderError extends Error {
  constructor(public provider: string, public status: number, public reason: string) {
    super(`${provider} ${status}: ${reason}`);
  }
}
function isQuotaError(status: number, body: string): boolean {
  if ([401, 402, 403, 429].includes(status)) return true;
  const b = body.toLowerCase();
  return b.includes("credit") || b.includes("quota") || b.includes("billing") || b.includes("insufficient");
}

// ── Provider adapters ───────────────────────────────────────────────────────

async function callGemini(model: string, system: string, messages: any[], maxTokens: number): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_KEY not set");
  const contents = messages.map((m: any) => ({
    role:  m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429 || isQuotaError(res.status, body))
      throw new ProviderError("gemini", res.status, body.slice(0, 200));
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const d = await res.json();
  const parts: any[] = d.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("") || "";
}

async function callAnthropic(model: string, system: string, messages: any[], maxTokens: number): Promise<string> {
  if (!ANTHROPIC_KEY) throw new ProviderError("anthropic", 401, "ANTHROPIC_KEY not set");
  // Merge consecutive same-role messages (Anthropic requires strict alternation)
  const merged: any[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      last.content += "\n\n" + (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
    } else {
      merged.push({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
    }
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body:    JSON.stringify({ model, max_tokens: maxTokens, system, messages: merged }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (isQuotaError(res.status, body) || res.status === 400)
      throw new ProviderError("anthropic", res.status, body.slice(0, 200));
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const d   = await res.json();
  const blocks: any[] = Array.isArray(d.content) ? d.content : [];
  return blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "";
}

async function callOpenAI(model: string, system: string, messages: any[], maxTokens: number): Promise<string> {
  if (!OPENAI_KEY) throw new ProviderError("openai", 401, "OPENAI_KEY not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body:    JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages:   [{ role: "system", content: system }, ...messages],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (isQuotaError(res.status, body) || res.status === 400)
      throw new ProviderError("openai", res.status, body.slice(0, 200));
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function callXAI(model: string, system: string, messages: any[], maxTokens: number): Promise<string> {
  if (!XAI_KEY) throw new ProviderError("xai", 401, "XAI_KEY not set");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${XAI_KEY}` },
    body:    JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages:   [{ role: "system", content: system }, ...messages],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (isQuotaError(res.status, body) || res.status === 400)
      throw new ProviderError("xai", res.status, body.slice(0, 200));
    throw new Error(`xAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

function detectProvider(model: string): "gemini" | "anthropic" | "openai" | "xai" {
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("grok-"))   return "xai";
  return "openai";
}

// ── MAVIS Choice cascade ────────────────────────────────────────────────────
// Called after free Gemini is exhausted. Routes by task complexity.
type RouteResult = { content: string; model_used: string; provider: string };

async function tryModel(
  provider: "gemini" | "anthropic" | "openai" | "xai",
  model: string,
  cbKey: string,
  system: string,
  messages: any[],
  maxTokens: number,
): Promise<RouteResult | null> {
  if (isUnhealthy(cbKey)) return null;
  try {
    let content = "";
    if (provider === "gemini"    && GEMINI_KEY)    content = await callGemini(model, system, messages, maxTokens);
    if (provider === "anthropic" && ANTHROPIC_KEY) content = await callAnthropic(model, system, messages, maxTokens);
    if (provider === "openai"    && OPENAI_KEY)    content = await callOpenAI(model, system, messages, maxTokens);
    if (provider === "xai"       && XAI_KEY)       content = await callXAI(model, system, messages, maxTokens);
    if (!content && !GEMINI_KEY && !ANTHROPIC_KEY && !OPENAI_KEY && !XAI_KEY) return null;
    return content ? { content, model_used: model, provider } : null;
  } catch (err: any) {
    if (err instanceof ProviderError) {
      markUnhealthy(cbKey, err.status === 429 ? 60_000 : 120_000);
    }
    console.warn(`[router] ${model} failed:`, err.message);
    return null;
  }
}

async function mavisChoiceCascade(
  taskType: string,
  system: string,
  messages: any[],
  maxTokens: number,
): Promise<RouteResult> {
  const task = taskType.toLowerCase();

  // Real-time / news / market → Grok → GPT-4o-mini
  if (["search", "realtime", "news", "market", "weather"].some(t => task.includes(t))) {
    const r = await tryModel("xai", "grok-3-mini", "grok-3-mini", system, messages, maxTokens);
    if (r) return r;
  }

  // Code / debug / refactor → Claude Sonnet → GPT-4o
  if (["code", "debug", "programming", "refactor", "script"].some(t => task.includes(t))) {
    const r1 = await tryModel("anthropic", "claude-sonnet-4-6", "claude-sonnet", system, messages, maxTokens);
    if (r1) return r1;
    const r2 = await tryModel("openai", "gpt-4o", "gpt-4o", system, messages, maxTokens);
    if (r2) return r2;
  }

  // Complex / reasoning / analysis / strategy → Gemini 2.5 Flash → Claude Sonnet → GPT-4o
  if (["complex", "reasoning", "analysis", "strategy", "deep", "plan"].some(t => task.includes(t))) {
    const r1 = await tryModel("gemini", "gemini-2.5-flash-preview-05-20", "gemini-2.5-flash", system, messages, maxTokens);
    if (r1) return r1;
    const r2 = await tryModel("anthropic", "claude-sonnet-4-6", "claude-sonnet", system, messages, maxTokens);
    if (r2) return r2;
    const r3 = await tryModel("openai", "gpt-4o", "gpt-4o", system, messages, maxTokens);
    if (r3) return r3;
  }

  // Default / chat / simple → Claude Haiku → GPT-4o-mini → Grok-mini
  const d1 = await tryModel("anthropic", "claude-haiku-4-5-20251001", "claude-haiku", system, messages, maxTokens);
  if (d1) return d1;
  const d2 = await tryModel("openai", "gpt-4o-mini", "gpt-4o-mini", system, messages, maxTokens);
  if (d2) return d2;
  const d3 = await tryModel("xai", "grok-3-mini", "grok-3-mini", system, messages, maxTokens);
  if (d3) return d3;

  throw new Error("All AI providers are currently unavailable. Check API keys and quotas.");
}

// ── Main cascade ────────────────────────────────────────────────────────────
async function route(
  model: string | undefined,
  taskType: string | undefined,
  system: string,
  messages: any[],
  maxTokens: number,
): Promise<RouteResult & { cost_usd: number }> {
  const inputChars = system.length + messages.reduce((n: number, m: any) => n + (m.content?.length ?? 0), 0);
  let result: RouteResult | null = null;

  // ── Step 1: Free Gemini 2.0 Flash ────────────────────────────────────────
  if (GEMINI_KEY && !isUnhealthy("gemini-2.0-flash")) {
    try {
      const content = await callGemini("gemini-2.0-flash", system, messages, maxTokens);
      result = { content, model_used: "gemini-2.0-flash", provider: "gemini" };
    } catch (err: any) {
      const ttl = err instanceof ProviderError && err.status === 429 ? 60_000 : 120_000;
      markUnhealthy("gemini-2.0-flash", ttl);
      console.warn("[router] gemini-2.0-flash failed:", err.message);
    }
  }

  // ── Step 2: Free Gemini 2.0 Flash Lite (separate rate-limit pool) ────────
  if (!result && GEMINI_KEY && !isUnhealthy("gemini-2.0-flash-lite")) {
    try {
      const content = await callGemini("gemini-2.0-flash-lite", system, messages, maxTokens);
      result = { content, model_used: "gemini-2.0-flash-lite", provider: "gemini" };
    } catch (err: any) {
      const ttl = err instanceof ProviderError && err.status === 429 ? 60_000 : 120_000;
      markUnhealthy("gemini-2.0-flash-lite", ttl);
      console.warn("[router] gemini-2.0-flash-lite failed:", err.message);
    }
  }

  // ── Step 3: Caller-specified explicit model ───────────────────────────────
  if (!result && model && model !== "mavis-choice") {
    const prov = detectProvider(model);
    result = await tryModel(prov, model, model, system, messages, maxTokens);
    if (!result) console.warn(`[router] explicit model ${model} failed, falling to MAVIS Choice`);
  }

  // ── Step 4: MAVIS Choice smart cascade ────────────────────────────────────
  if (!result) {
    result = await mavisChoiceCascade(taskType ?? "chat", system, messages, maxTokens);
  }

  const cost_usd = estimateCost(result.model_used, inputChars, result.content.length);
  return { ...result, cost_usd };
}

// ── Context-window guard ────────────────────────────────────────────────────
// Approximates 4 chars ≈ 1 token. Trims oldest messages (keeping the final
// user turn) until total input fits inside the target context window.
function fitMessagesToContext(
  system: string,
  messages: any[],
  maxTokens: number,
  ctxWindow = 128_000,
): any[] {
  const SAFETY = 2000;
  const budgetTokens = Math.max(1000, ctxWindow - Math.min(maxTokens, ctxWindow / 2) - SAFETY);
  const budgetChars  = budgetTokens * 4;
  const sysChars     = system.length;

  const msgChars = (m: any) => (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length);
  let total = sysChars + messages.reduce((n, m) => n + msgChars(m), 0);
  if (total <= budgetChars) return messages;

  // Always keep the last message; drop from the front until we fit.
  const kept = [...messages];
  while (kept.length > 1 && total > budgetChars) {
    const dropped = kept.shift();
    total -= msgChars(dropped);
  }
  // If the last message alone still overflows, truncate its content head.
  if (total > budgetChars && kept.length === 1) {
    const last = kept[0];
    const allowed = Math.max(2000, budgetChars - sysChars);
    const content = typeof last.content === "string" ? last.content : JSON.stringify(last.content ?? "");
    kept[0] = { ...last, content: content.slice(-allowed) };
  }
  return kept;
}

// ── HTTP handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { model, task_type, system, messages, max_tokens = 1200 } = await req.json();

    if (!system || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "system and messages[] required" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Cap completion tokens and fit history to the tightest common ctx window (128k)
    const cappedMax = Math.min(Number(max_tokens) || 1200, 4096);
    const fitted    = fitMessagesToContext(system, messages, cappedMax, 128_000);

    const result = await route(model, task_type, system, fitted, cappedMax);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[mavis-llm-router]", err);
    return new Response(JSON.stringify({ error: err.message ?? "Router error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
