// _shared/providers.ts
// Provider waterfall: health-tracked fallback chain across Gemini/Groq/OpenAI/
// Claude/Grok, both blocking and streaming — extracted from mavis-chat/index.ts
// (Stabilization Brief Phase 2.6), later promoted to _shared/ so
// mavis-persona-router could reuse the same free-tier-first cascade instead
// of its own thinner, paid-providers-only fallback chain. Fully
// parameter-driven, zero request-scope closure dependencies.

// ── Provider health TTL (circuit-breaker) ─────────────────────────────────────
// Module-level Map persists within a warm Deno isolate; prevents hammering a
// degraded provider on repeated requests within the same isolate lifetime.
const _providerUnhealthyUntil = new Map<string, number>();
export function isProviderUnhealthy(name: string): boolean {
  const until = _providerUnhealthyUntil.get(name);
  return until !== undefined && Date.now() < until;
}
export function markProviderUnhealthy(name: string, ttlMs = 120_000): void {
  _providerUnhealthyUntil.set(name, Date.now() + ttlMs);
}

// ============================================================
// CAPABILITY ROUTER
// Claude   → ARCH, CODEX, SOVEREIGN (deep reasoning)
// Grok     → WATCHTOWER, COURT, real-time intel
// OpenAI   → PRIME, QUEST, FORGE, ENRYU, default
// ============================================================
export type Provider = "claude" | "grok" | "openai" | "gemini";

export const OPENAI_CONTEXT_WINDOW_TOKENS = 128_000;
export const OPENAI_MAX_COMPLETION_TOKENS = 2_048;
export const OPENAI_CONTEXT_SAFETY_TOKENS = 6_000;

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export function contentCharLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  try { return JSON.stringify(content ?? "").length; } catch { return String(content ?? "").length; }
}

export function shortenTextMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 2000) return text.slice(-Math.max(500, maxChars));
  const marker = "\n\n[Earlier context compressed to fit provider window]\n\n";
  const head = Math.max(1000, Math.floor((maxChars - marker.length) * 0.55));
  const tail = Math.max(1000, maxChars - marker.length - head);
  return text.slice(0, head) + marker + text.slice(-tail);
}

export function trimMessageContent(message: any, maxChars: number): any {
  if (maxChars <= 0) return { ...message, content: "[Message omitted to fit provider context]" };
  if (typeof message.content === "string") {
    return { ...message, content: shortenTextMiddle(message.content, maxChars) };
  }
  const serialized = JSON.stringify(message.content ?? "");
  if (serialized.length <= maxChars) return message;
  return { ...message, content: shortenTextMiddle(serialized, maxChars) };
}

export function fitOpenAIRequest(
  system: string,
  messages: any[],
  requestedCompletionTokens = OPENAI_MAX_COMPLETION_TOKENS,
): { system: string; messages: any[]; maxTokens: number } {
  const maxTokens = Math.max(512, Math.min(requestedCompletionTokens, OPENAI_MAX_COMPLETION_TOKENS));
  const inputBudgetChars = Math.max(
    16_000,
    (OPENAI_CONTEXT_WINDOW_TOKENS - maxTokens - OPENAI_CONTEXT_SAFETY_TOKENS) * 4,
  );
  const msgLen = (m: any) => contentCharLength(m?.content) + 32;

  let fittedSystem = system;
  let fittedMessages = [...messages];
  let total = fittedSystem.length + fittedMessages.reduce((sum, m) => sum + msgLen(m), 0);
  if (total <= inputBudgetChars) return { system: fittedSystem, messages: fittedMessages, maxTokens };

  while (fittedMessages.length > 2 && total > inputBudgetChars) {
    const dropped = fittedMessages.shift();
    total -= msgLen(dropped);
  }

  if (total > inputBudgetChars) {
    const messageChars = fittedMessages.reduce((sum, m) => sum + msgLen(m), 0);
    const systemBudget = Math.max(24_000, inputBudgetChars - messageChars);
    if (fittedSystem.length > systemBudget) {
      fittedSystem = shortenTextMiddle(fittedSystem, systemBudget);
    }
  }

  total = fittedSystem.length + fittedMessages.reduce((sum, m) => sum + msgLen(m), 0);
  if (total > inputBudgetChars && fittedMessages.length > 0) {
    const systemChars = fittedSystem.length;
    const availableForMessages = Math.max(2_000, inputBudgetChars - systemChars);
    const perMessageBudget = Math.max(1_000, Math.floor(availableForMessages / fittedMessages.length));
    fittedMessages = fittedMessages.map((m, idx) => {
      const current = contentCharLength(m?.content);
      const budget = idx === fittedMessages.length - 1 ? Math.max(perMessageBudget, availableForMessages - perMessageBudget * (fittedMessages.length - 1)) : perMessageBudget;
      return current > budget ? trimMessageContent(m, budget) : m;
    });
  }

  total = fittedSystem.length + fittedMessages.reduce((sum, m) => sum + msgLen(m), 0);
  if (total > inputBudgetChars) {
    const spareForSystem = Math.max(8_000, inputBudgetChars - fittedMessages.reduce((sum, m) => sum + msgLen(m), 0));
    fittedSystem = shortenTextMiddle(fittedSystem, spareForSystem);
  }

  const estimatedInputTokens = estimateTokensFromChars(fittedSystem.length + fittedMessages.reduce((sum, m) => sum + msgLen(m), 0));
  if (estimatedInputTokens + maxTokens > OPENAI_CONTEXT_WINDOW_TOKENS - 1_000) {
    console.warn(`[openai-context] request near limit after trimming: input≈${estimatedInputTokens}, completion=${maxTokens}`);
  }
  return { system: fittedSystem, messages: fittedMessages, maxTokens };
}

// Safety net: keep total input chars within the model's context budget.
// ~4 chars ≈ 1 token; 460k chars ≈ 115k tokens, leaving safe headroom for 8192 completion
// under gpt-4o-mini's 128k limit.  Two-pass: first drop old messages, then truncate the
// system prompt if it alone blows the budget (large agent_folders / contextSummary).
export function trimToFit(
  messages: any[],
  system: string,
  maxInputChars = 460_000,
  minKeep = 4,
): { messages: any[]; system: string } {
  const msgs = [...messages];
  let msgsLen = msgs.reduce((s: number, m: any) => s + JSON.stringify(m).length, 0);
  let totalLen = system.length + msgsLen;

  // Pass 1: drop oldest messages until under budget or at minKeep
  while (msgs.length > minKeep && totalLen > maxInputChars) {
    const dropped = msgs.shift()!;
    const dLen = JSON.stringify(dropped).length;
    msgsLen -= dLen;
    totalLen -= dLen;
  }

  // Pass 2: if still over budget (system prompt is enormous), truncate system to fit
  let trimmedSystem = system;
  if (totalLen > maxInputChars && system.length > 500) {
    const allowedSysLen = Math.max(500, maxInputChars - msgsLen - 300);
    trimmedSystem =
      system.slice(0, allowedSysLen) +
      "\n\n[... system context truncated to fit model token limit ...]";
  }

  return { messages: msgs, system: trimmedSystem };
}

export function routeToProvider(mode: string, message: string): Provider {
  const m = mode?.toUpperCase();
  if (["ARCH", "CODEX", "SOVEREIGN"].includes(m)) return "claude";
  if (["WATCHTOWER", "COURT"].includes(m)) return "grok";
  const lower = message?.toLowerCase() ?? "";
  const realtimeTriggers = [
    "what's happening", "latest news", "breaking", "right now", "today",
    "this week", "current events", "market", "trending", "stock", "crypto",
    "election", "weather",
  ];
  if (realtimeTriggers.some((t) => lower.includes(t))) return "grok";
  if (m === "DEEP") return "gemini"; // thinking mode stays on Gemini
  return "openai";
}

// ============================================================
// PROVIDER ADAPTERS
// Throw ProviderUnavailableError on credit/quota/auth failures
// so the cascade can move to the next provider.
// ============================================================
export class ProviderUnavailableError extends Error {
  constructor(public providerName: string, public reason: string, public status: number) {
    super(`${providerName} unavailable (${status}): ${reason}`);
  }
}

export function isUnfundedStatus(status: number, body: string): boolean {
  if ([401, 402, 403, 429].includes(status)) return true;
  const b = body.toLowerCase();
  return b.includes("credit") || b.includes("quota") || b.includes("billing") || b.includes("payment") || b.includes("insufficient");
}

export async function callOpenAI(messages: any[], system: string, key: string, model = "gpt-4o-mini"): Promise<string> {
  const fitted = fitOpenAIRequest(system, messages);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: fitted.system }, ...fitted.messages],
      max_tokens: fitted.maxTokens,
      temperature: 0.85,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (isUnfundedStatus(res.status, errText) || res.status === 400) {
      throw new ProviderUnavailableError("openai", errText.slice(0, 200), res.status);
    }
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

export async function callClaude(messages: any[], system: string, key: string, model = "claude-haiku-4-5-20251001", useThinking = false): Promise<string> {
  // Anthropic requires strictly alternating user/assistant roles. Merge consecutive
  // same-role messages so a bad history never causes an unrecoverable 400.
  const merged: any[] = [];
  for (const m of messages) {
    if (merged.length > 0 && merged[merged.length - 1].role === m.role) {
      merged[merged.length - 1] = { role: m.role, content: merged[merged.length - 1].content + "\n\n" + (typeof m.content === "string" ? m.content : JSON.stringify(m.content)) };
    } else {
      merged.push({ role: m.role, content: m.content });
    }
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": useThinking
        ? "prompt-caching-2024-07-31,interleaved-thinking-2025-05-14"
        : "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model,
      max_tokens: useThinking ? 16000 : 8192,
      ...(useThinking ? { thinking: { type: "enabled", budget_tokens: 8000 } } : {}),
      system,
      messages: merged.map((m: any) => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(useThinking ? 60_000 : 45_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    // Treat 400 "bad request" as cascadable (same as quota errors) — bad message format
    // should cascade to the next provider rather than blow up with a 500.
    if (isUnfundedStatus(res.status, errText) || res.status === 400) {
      throw new ProviderUnavailableError("claude", errText.slice(0, 200), res.status);
    }
    throw new Error(`Claude ${res.status}: ${errText}`);
  }
  const d = await res.json();
  // Filter out thinking blocks — return only text content blocks
  const blocks: any[] = Array.isArray(d.content) ? d.content : [];
  return blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "";
}

export async function callGrok(messages: any[], system: string, key: string): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 8192,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (isUnfundedStatus(res.status, errText) || res.status === 400) {
      throw new ProviderUnavailableError("grok", errText.slice(0, 200), res.status);
    }
    throw new Error(`Grok ${res.status}: ${errText}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

export async function callGemini(messages: any[], system: string, key: string, opts: { model?: string; thinking?: boolean; grounding?: boolean; codeExec?: boolean } = {}): Promise<string> {
  const contents = messages.map((m: any) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
  // Use opts.model if provided; thinking requires the 2.5 preview model.
  const geminiModel = opts.thinking
    ? "gemini-flash-latest"
    : (opts.model ?? "gemini-flash-latest");
  const body: any = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: opts.thinking ? 16384 : 4096 },
  };
  if (opts.thinking) body.generationConfig.thinkingConfig = { thinkingBudget: 8192 };
  if (opts.grounding && !opts.thinking) body.tools = [{ googleSearch: {} }];
  else if (opts.codeExec && !opts.thinking) body.tools = [{ codeExecution: {} }];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.thinking ? 60_000 : 30_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) throw new ProviderUnavailableError("gemini", errText.slice(0, 200), res.status);
    if (res.status === 403) throw new ProviderUnavailableError("gemini", errText.slice(0, 200), res.status);
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }
  const d = await res.json();
  const parts: any[] = d.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("") || "";
}

// Cascade order (free → cheapest → premium):
//   0a. Gemini `gemini-flash-latest` (free tier, mode-specific tools)
//   0b. Groq   (free tier)
//   0c. Lovable AI Gateway (workspace credits — first tier that costs money)
//   2.  Mode-designated provider (Claude Sonnet for ARCH/CODEX, Grok for WATCHTOWER)
//   3.  OpenAI gpt-4o-mini
//   4.  Claude Haiku
//   5.  Claude Sonnet
//   6.  Grok (last resort)
export async function callWithFallback(
  primary: Provider,
  messages: any[],
  system: string,
  keys: { openai: string; claude: string; grok: string; gemini: string; groq: string; lovable?: string },
  useThinking = false,
  mode = "PRIME",
): Promise<{ content: string; provider: string }> {
  const mU = mode.toUpperCase();

  // Tier 0a — Gemini on the rolling `gemini-flash-latest` alias (free tier).
  //
  // This was three consecutive Gemini attempts: gemini-2.0-flash, then
  // gemini-2.0-flash-lite, then this one. Google has retired both pinned
  // versions — verified against production, they answer
  //   404 "This model models/gemini-2.0-flash is no longer available.
  //        Please update your code to use models/gemini-3.6-flash"
  // — so the first two tiers could not succeed, only burn a round trip.
  //
  // The ordering consequence was the expensive part. Those two dead tiers sat
  // above the Lovable gateway, and Groq's pinned model is likewise
  // decommissioned (404 model_not_found), so all three free tiers failed in
  // sequence and every request in the system landed on Lovable and spent
  // workspace credits — while the free Gemini tier that does work sat below it
  // and was never reached. That is the exact inverse of what this cascade
  // exists to do, and it is what exhausted the workspace credit limit
  // ("credit_limit_reached", observed in production).
  //
  // One Gemini tier now, on the alias rather than a pinned version, so it
  // cannot rot silently the next time Google retires a model. Kept above every
  // paid tier, which is the whole point of the ordering.
  if (keys.gemini && !isProviderUnhealthy("gemini")) {
    try {
      const geminiOpts = {
        thinking:  mU === "DEEP",
        grounding: ["WATCHTOWER", "GROUNDED"].includes(mU),
        codeExec:  ["DATA", "CODEX", "RESEARCH"].includes(mU),
      };
      return { content: await callGemini(messages, system, keys.gemini, geminiOpts), provider: geminiOpts.thinking ? "gemini-2.5-thinking" : "gemini-flash-latest" };
    } catch (err: any) {
      if (err instanceof ProviderUnavailableError) markProviderUnhealthy("gemini");
      console.warn(`[fallback] Gemini failed (${err.message}) → cascading`);
    }
  }

  // Tier 0b — Groq (free tier, ~500 tok/s, no thinking overhead)
  if (keys.groq && mU !== "DEEP" && !isProviderUnhealthy("groq-llama")) {
    try {
      return { content: await callGroq(messages, system, keys.groq), provider: GROQ_MODEL };
    } catch (err: any) {
      if (err instanceof ProviderUnavailableError) markProviderUnhealthy("groq-llama", 60_000);
      console.warn(`[fallback] Groq failed (${err.message}) → cascading`);
    }
  }

  // Tier 0c — Lovable AI Gateway. First tier that costs money (workspace
  // credits), so it must stay below both free tiers above.
  if (keys.lovable && !isProviderUnhealthy("lovable")) {
    try {
      return { content: await callLovable(messages, system, keys.lovable, { thinking: mU === "DEEP" }), provider: "lovable-gateway" };
    } catch (err: any) {
      if (err instanceof ProviderUnavailableError) markProviderUnhealthy("lovable", err.status === 429 ? 60_000 : 300_000);
      console.warn(`[fallback] Lovable gateway failed (${err.message}) → cascading`);
    }
  }

  // Tier 2 — Mode-designated provider (Claude for deep reasoning, Grok for real-time)
  if (primary === "claude" && keys.claude && !isProviderUnhealthy("claude")) {
    try {
      return { content: await callClaude(messages, system, keys.claude, "claude-sonnet-4-6", useThinking), provider: useThinking ? "claude-sonnet-thinking" : "claude-sonnet" };
    } catch (err: any) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      markProviderUnhealthy("claude");
      console.warn(`[fallback] claude-sonnet unfunded (${err.status}) → cascading`);
    }
  }
  if (primary === "grok" && keys.grok && !isProviderUnhealthy("grok")) {
    try {
      return { content: await callGrok(messages, system, keys.grok), provider: "grok" };
    } catch (err: any) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      markProviderUnhealthy("grok");
      console.warn(`[fallback] grok unfunded (${err.status}) → cascading`);
    }
  }

  // Tier 3 — OpenAI (gpt-4o-mini, cheap)
  if (keys.openai && !isProviderUnhealthy("openai")) {
    try {
      return { content: await callOpenAI(messages, system, keys.openai, "gpt-4o-mini"), provider: "openai-mini" };
    } catch (err: any) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      markProviderUnhealthy("openai");
      console.warn(`[fallback] OpenAI unfunded (${err.status}) → trying Claude Haiku`);
    }
  }

  // Tier 4 — Claude Haiku (cheap)
  if (keys.claude && !isProviderUnhealthy("claude")) {
    try {
      return { content: await callClaude(messages, system, keys.claude, "claude-haiku-4-5-20251001"), provider: "claude-haiku" };
    } catch (err: any) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      markProviderUnhealthy("claude");
      console.warn(`[fallback] Claude Haiku unfunded (${err.status}) → trying Claude Sonnet`);
    }
  }

  // Tier 5 — Claude Sonnet (premium)
  if (keys.claude && !isProviderUnhealthy("claude-sonnet")) {
    try {
      return { content: await callClaude(messages, system, keys.claude, "claude-sonnet-4-6"), provider: "claude-sonnet" };
    } catch (err: any) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      markProviderUnhealthy("claude-sonnet");
      console.warn(`[fallback] Claude Sonnet unfunded (${err.status}) → trying Grok`);
    }
  }

  // Tier 6 — Grok (last resort)
  if (keys.grok && !isProviderUnhealthy("grok")) {
    try {
      return { content: await callGrok(messages, system, keys.grok), provider: "grok" };
    } catch (err: any) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      markProviderUnhealthy("grok");
      console.warn(`[fallback] Grok unfunded (${err.status})`);
    }
  }

  throw new Error("All AI providers unavailable (no funded keys).");
}

// ============================================================
// STREAMING AI PROVIDER ADAPTERS
// Mirror the non-streaming adapters above but return
// ReadableStream<string> of text tokens for SSE delivery.
// ============================================================

export function oaiSseToTextStream(body: ReadableStream<Uint8Array>): ReadableStream<string> {
  const decoder = new TextDecoder();
  const reader  = body.getReader();
  let buf = "";
  return new ReadableStream<string>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush any remaining bytes in the decoder buffer
            const tail = decoder.decode();
            if (tail) buf += tail;
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") { controller.close(); return; }
            try {
              const j = JSON.parse(data);
              const t = j.choices?.[0]?.delta?.content;
              if (t) controller.enqueue(t);
            } catch { /* skip malformed */ }
          }
        }
        // Process any leftover buf after stream ends
        if (buf.trim()) {
          const data = buf.startsWith("data: ") ? buf.slice(6).trim() : buf.trim();
          if (data && data !== "[DONE]") {
            try {
              const j = JSON.parse(data);
              const t = j.choices?.[0]?.delta?.content;
              if (t) controller.enqueue(t);
            } catch { /* skip */ }
          }
        }
      } catch (e) {
        controller.error(e);
        return;
      }
      controller.close();
    }
  });
}

export function claudeSseToTextStream(body: ReadableStream<Uint8Array>): ReadableStream<string> {
  const decoder  = new TextDecoder();
  const reader   = body.getReader();
  const textIdxs = new Set<number>();
  let buf = "";

  function processLines(controller: ReadableStreamDefaultController<string>) {
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const j = JSON.parse(line.slice(6).trim());
        if (j.type === "content_block_start" && j.content_block?.type === "text") textIdxs.add(j.index);
        if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && textIdxs.has(j.index)) {
          const t = j.delta.text;
          if (t) controller.enqueue(t);
        }
        if (j.type === "message_stop") return true; // signal done
      } catch { /* skip malformed */ }
    }
    return false;
  }

  return new ReadableStream<string>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            buf += decoder.decode(); // flush remaining bytes
            processLines(controller);
            break;
          }
          buf += decoder.decode(value, { stream: true });
          if (processLines(controller)) break;
        }
      } catch (e) {
        controller.error(e);
        return;
      }
      controller.close();
    }
  });
}

// Two-stage timeout: fail fast if a provider never responds at all (a true
// stall — this is what makes fallback trigger promptly), without risking an
// abort mid-way through a legitimately long streaming reply. A flat short
// timeout would cut off valid long completions; a flat 90s+ timeout means a
// hung provider blocks the whole turn. Several of these stream calls (OpenAI,
// Claude, Groq) had NO timeout at all — an unbounded hang on a dead connection.
export async function fetchStreamWithFailover(
  url: string,
  init: RequestInit,
  { headerTimeoutMs = 15_000, totalTimeoutMs = 60_000 } = {},
): Promise<Response> {
  const controller = new AbortController();
  const headerTimer = setTimeout(() => controller.abort(new Error("no response headers within timeout")), headerTimeoutMs);
  const totalTimer  = setTimeout(() => controller.abort(new Error("total request timeout exceeded")), totalTimeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(headerTimer); // headers arrived — provider is alive; totalTimer still guards the body read
    return res;
  } catch (err) {
    clearTimeout(headerTimer);
    clearTimeout(totalTimer);
    throw err;
  }
}

export async function callOpenAIStream(messages: any[], system: string, key: string, model = "gpt-4o-mini"): Promise<ReadableStream<string>> {
  const fitted = fitOpenAIRequest(system, messages);
  const res = await fetchStreamWithFailover("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: fitted.system }, ...fitted.messages], max_tokens: fitted.maxTokens, temperature: 0.85, stream: true }),
  });
  if (!res.ok) {
    const e = await res.text();
    if (isUnfundedStatus(res.status, e)) throw new ProviderUnavailableError("openai", e.slice(0, 200), res.status);
    throw new Error(`OpenAI ${res.status}: ${e}`);
  }
  return oaiSseToTextStream(res.body!);
}

export async function callClaudeStream(messages: any[], system: string, key: string, model = "claude-haiku-4-5-20251001", useThinking = false): Promise<ReadableStream<string>> {
  const res = await fetchStreamWithFailover("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": useThinking
        ? "prompt-caching-2024-07-31,interleaved-thinking-2025-05-14"
        : "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model,
      max_tokens: useThinking ? 16000 : 8192,
      ...(useThinking ? { thinking: { type: "enabled", budget_tokens: 8000 } } : {}),
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
      stream: true,
    }),
  });
  if (!res.ok) {
    const e = await res.text();
    if (isUnfundedStatus(res.status, e)) throw new ProviderUnavailableError("claude", e.slice(0, 200), res.status);
    throw new Error(`Claude ${res.status}: ${e}`);
  }
  return claudeSseToTextStream(res.body!);
}

export function geminiSseToTextStream(body: ReadableStream<Uint8Array>, filterThoughts = false): ReadableStream<string> {
  const decoder = new TextDecoder();
  const reader  = body.getReader();
  let buf = "";
  return new ReadableStream<string>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            const tail = decoder.decode();
            if (tail) buf += tail;
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") { controller.close(); return; }
            try {
              const j = JSON.parse(data);
              const rawParts: any[] = j.candidates?.[0]?.content?.parts ?? [];
              for (const p of rawParts) {
                if (!p.text) continue;
                if (filterThoughts && p.thought) continue;
                controller.enqueue(p.text);
              }
            } catch { /* skip malformed */ }
          }
        }
        if (buf.trim()) {
          const data = buf.startsWith("data: ") ? buf.slice(6).trim() : buf.trim();
          if (data && data !== "[DONE]") {
            try {
              const j = JSON.parse(data);
              const rawParts: any[] = j.candidates?.[0]?.content?.parts ?? [];
              for (const p of rawParts) {
                if (!p.text) continue;
                if (filterThoughts && p.thought) continue;
                controller.enqueue(p.text);
              }
            } catch { /* skip */ }
          }
        }
      } catch (e) {
        controller.error(e);
        return;
      }
      controller.close();
    }
  });
}

export async function callGeminiStream(messages: any[], system: string, key: string, opts: { thinking?: boolean; grounding?: boolean; codeExec?: boolean } = {}): Promise<ReadableStream<string>> {
  const contents = messages.map((m: any) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
  const body: any = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: opts.thinking ? 16384 : 4096 },
  };
  if (opts.thinking) body.generationConfig.thinkingConfig = { thinkingBudget: 8192 };
  if (opts.grounding && !opts.thinking) body.tools = [{ googleSearch: {} }];
  else if (opts.codeExec && !opts.thinking) body.tools = [{ codeExecution: {} }];
  const res = await fetchStreamWithFailover(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?key=${key}&alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.text().catch(() => "");
    if (res.status === 429 || res.status === 403) throw new ProviderUnavailableError("gemini", e.slice(0, 200), res.status);
    throw new Error(`Gemini stream ${res.status}: ${e.slice(0, 200)}`);
  }
  return geminiSseToTextStream(res.body!, opts.thinking);
}

export async function callGrokStream(messages: any[], system: string, key: string): Promise<ReadableStream<string>> {
  const res = await fetchStreamWithFailover("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "grok-3-mini", messages: [{ role: "system", content: system }, ...messages], max_tokens: 8192, temperature: 0.7, stream: true }),
  });
  if (!res.ok) {
    const e = await res.text();
    if (isUnfundedStatus(res.status, e)) throw new ProviderUnavailableError("grok", e.slice(0, 200), res.status);
    throw new Error(`Grok ${res.status}: ${e}`);
  }
  return oaiSseToTextStream(res.body!);
}

// ── Groq (~500 tok/s, generous free tier) ─────────────────────────────────
//
// `llama-3.3-70b-versatile` was pinned here and Groq has decommissioned it —
// verified against production, it answers
//   404 {"error":{"message":"The model `llama-3.3-70b-versatile` does not
//        exist or you do not have access to it.","code":"model_not_found"}}
// so this whole tier was dead across every function that uses the cascade.
//
// Unlike Gemini, Groq publishes no rolling `-latest` alias, so a pinned ID is
// unavoidable and will eventually rot again the same way. Reading it from the
// environment means the next decommission is a secret change in the Supabase
// dashboard rather than a redeploy of every function that bundles this module
// — which matters here specifically, because _shared is bundled per-function
// at deploy time and a change to this file does NOT redeploy its dependents.
export const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "llama-3.1-8b-instant";

export async function callGroq(messages: any[], system: string, key: string, model = GROQ_MODEL): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 8192,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const e = await res.text();
    if (isUnfundedStatus(res.status, e)) throw new ProviderUnavailableError("groq", e.slice(0, 200), res.status);
    throw new Error(`Groq ${res.status}: ${e}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

export async function callGroqStream(messages: any[], system: string, key: string, model = GROQ_MODEL): Promise<ReadableStream<string>> {
  const res = await fetchStreamWithFailover("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], max_tokens: 8192, temperature: 0.7, stream: true }),
  });
  if (!res.ok) {
    const e = await res.text();
    if (isUnfundedStatus(res.status, e)) throw new ProviderUnavailableError("groq", e.slice(0, 200), res.status);
    throw new Error(`Groq ${res.status}: ${e}`);
  }
  return oaiSseToTextStream(res.body!);
}

export async function callWithFallbackStream(
  primary: Provider,
  messages: any[],
  system: string,
  keys: { openai: string; claude: string; grok: string; gemini: string; groq: string; lovable?: string },
  useThinking = false,
  mode = "PRIME",
): Promise<{ stream: ReadableStream<string>; provider: string }> {
  const mU = mode.toUpperCase();
  // Health-key names match callWithFallback's (non-streaming) so a provider
  // marked unhealthy by one path is also skipped by the other — previously
  // this cascade never consulted or updated provider health at all, so a
  // request could keep re-attempting a provider that had just rate-limited
  // or errored moments earlier on the exact same isolate.
  // Tier 0 — Free Gemini (always attempted first)
  if (keys.gemini && !isProviderUnhealthy("gemini")) {
    try {
      const geminiOpts = {
        thinking: mU === "DEEP",
        grounding: ["WATCHTOWER", "GROUNDED"].includes(mU),
        codeExec: ["DATA", "CODEX", "RESEARCH"].includes(mU),
      };
      return { stream: await callGeminiStream(messages, system, keys.gemini, geminiOpts), provider: geminiOpts.thinking ? "gemini-2.5-thinking" : "gemini-flash-latest" };
    }
    catch (e: any) {
      if (e instanceof ProviderUnavailableError) markProviderUnhealthy("gemini", e.status === 429 ? 60_000 : 120_000);
      console.warn(`[stream-fallback] Gemini 2.5 Flash: ${e.message} → cascading`);
    }
  }
  // Tier 0b — Groq (~500 tok/s)
  if (keys.groq && mU !== "DEEP" && !isProviderUnhealthy("groq-llama")) {
    try { return { stream: await callGroqStream(messages, system, keys.groq), provider: GROQ_MODEL }; }
    catch (e: any) {
      if (e instanceof ProviderUnavailableError) markProviderUnhealthy("groq-llama", 60_000);
      console.warn(`[stream-fallback] Groq: ${e.message} → cascading`);
    }
  }
  // Tier 0c — Lovable AI Gateway (workspace credits)
  if (keys.lovable && !isProviderUnhealthy("lovable")) {
    try { return { stream: await callLovableStream(messages, system, keys.lovable, { thinking: mU === "DEEP" }), provider: "lovable-gateway" }; }
    catch (e: any) {
      if (e instanceof ProviderUnavailableError) markProviderUnhealthy("lovable", e.status === 429 ? 60_000 : 300_000);
      console.warn(`[stream-fallback] Lovable gateway: ${e.message} → cascading`);
    }
  }
  // Tier 1 — Mode-designated provider
  if (primary === "claude" && keys.claude && !isProviderUnhealthy("claude")) {
    try {
      const stream = await callClaudeStream(messages, system, keys.claude, "claude-sonnet-4-6", useThinking);
      return { stream, provider: useThinking ? "claude-sonnet-thinking" : "claude-sonnet" };
    } catch (e: any) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
      markProviderUnhealthy("claude");
    }
  }
  if (primary === "grok" && keys.grok && !isProviderUnhealthy("grok")) {
    try { return { stream: await callGrokStream(messages, system, keys.grok), provider: "grok" }; }
    catch (e: any) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
      markProviderUnhealthy("grok");
    }
  }
  if (keys.openai && !isProviderUnhealthy("openai")) {
    try { return { stream: await callOpenAIStream(messages, system, keys.openai), provider: "openai-mini" }; }
    catch (e: any) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
      markProviderUnhealthy("openai");
    }
  }
  if (keys.claude && !isProviderUnhealthy("claude")) {
    try { return { stream: await callClaudeStream(messages, system, keys.claude, "claude-haiku-4-5-20251001", false), provider: "claude-haiku" }; }
    catch (e: any) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
      markProviderUnhealthy("claude");
    }
  }
  if (keys.grok && !isProviderUnhealthy("grok")) {
    try { return { stream: await callGrokStream(messages, system, keys.grok), provider: "grok" }; }
    catch (e: any) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
      markProviderUnhealthy("grok");
    }
  }
  throw new Error("All AI providers unavailable for streaming (no funded keys).");
}

// ============================================================
// LOVABLE AI GATEWAY ADAPTER + UNIVERSAL ENTRYPOINT
// Every edge function that needs text completion should call
// `aiComplete` (or `aiCompleteStream`) instead of hitting a
// single provider directly, so one provider outage / 402 / 429
// can never produce a user-facing 500.
// ============================================================

export const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const LOVABLE_DEFAULT_MODEL = "google/gemini-3.6-flash";

export interface LovableOpts { model?: string; maxTokens?: number; thinking?: boolean; temperature?: number }

function lovableBody(messages: any[], system: string, opts: LovableOpts, stream: boolean) {
  return JSON.stringify({
    model: opts.model ?? LOVABLE_DEFAULT_MODEL,
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: opts.maxTokens ?? (opts.thinking ? 8192 : 4096),
    temperature: opts.temperature ?? 0.8,
    ...(stream ? { stream: true } : {}),
  });
}

function lovableHeaders(key: string) {
  return {
    "Content-Type": "application/json",
    // The gateway authenticates on this header — never `Authorization: Bearer`.
    "Lovable-API-Key": key,
    "X-Lovable-AIG-SDK": "fetch",
  };
}

export async function callLovable(messages: any[], system: string, key: string, opts: LovableOpts = {}): Promise<string> {
  const res = await fetch(LOVABLE_GATEWAY_URL, {
    method: "POST",
    headers: lovableHeaders(key),
    body: lovableBody(messages, system, opts, false),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (isUnfundedStatus(res.status, errText)) throw new ProviderUnavailableError("lovable", errText.slice(0, 200), res.status);
    throw new ProviderUnavailableError("lovable", errText.slice(0, 200), res.status);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

export async function callLovableStream(messages: any[], system: string, key: string, opts: LovableOpts = {}): Promise<ReadableStream<string>> {
  const res = await fetch(LOVABLE_GATEWAY_URL, {
    method: "POST",
    headers: lovableHeaders(key),
    body: lovableBody(messages, system, opts, true),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderUnavailableError("lovable", errText.slice(0, 200), res.status);
  }
  return oaiSseToTextStream(res.body!);
}

/** Read every provider key this project supports from the function environment. */
export function getProviderKeys(): { openai: string; claude: string; grok: string; gemini: string; groq: string; lovable: string } {
  return {
    gemini:  Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_API_KEY") ?? "",
    groq:    Deno.env.get("GROQ_API_KEY") ?? "",
    lovable: Deno.env.get("LOVABLE_API_KEY") ?? "",
    openai:  Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "",
    claude:  Deno.env.get("ANTHROPIC_API_KEY") ?? "",
    grok:    Deno.env.get("XAI_API_KEY") ?? Deno.env.get("GROK_API_KEY") ?? "",
  };
}

export interface AiCompleteOpts {
  system?: string;
  user?: string;
  messages?: any[];
  mode?: string;
  thinking?: boolean;
  /** Try the Lovable AI Gateway before the project's own free keys. */
  preferLovable?: boolean;
}

/**
 * Universal free-first text completion.
 * Order: free Gemini 2.0 Flash → Flash-Lite → Groq Llama → Lovable Gateway →
 *        paid Gemini 2.5 → mode provider → OpenAI → Claude → Grok.
 * Throws only when every configured provider is unavailable.
 */
export async function aiComplete(opts: AiCompleteOpts): Promise<{ content: string; provider: string }> {
  const system = opts.system ?? "You are a helpful assistant.";
  const messages = opts.messages ?? [{ role: "user", content: opts.user ?? "" }];
  const mode = opts.mode ?? (opts.thinking ? "DEEP" : "PRIME");
  const keys = getProviderKeys();
  const primary = routeToProvider(mode, typeof messages.at(-1)?.content === "string" ? messages.at(-1).content : "");

  if (opts.preferLovable && keys.lovable && !isProviderUnhealthy("lovable")) {
    try {
      return { content: await callLovable(messages, system, keys.lovable, { thinking: opts.thinking }), provider: "lovable-gateway" };
    } catch (err: any) {
      if (err instanceof ProviderUnavailableError) markProviderUnhealthy("lovable", err.status === 429 ? 60_000 : 300_000);
      console.warn(`[aiComplete] lovable gateway failed (${err.message}) → free cascade`);
    }
  }

  return await callWithFallback(primary, messages, system, keys, !!opts.thinking, mode);
}

/** Streaming variant of `aiComplete`. */
export async function aiCompleteStream(opts: AiCompleteOpts): Promise<{ stream: ReadableStream<string>; provider: string }> {
  const system = opts.system ?? "You are a helpful assistant.";
  const messages = opts.messages ?? [{ role: "user", content: opts.user ?? "" }];
  const mode = opts.mode ?? (opts.thinking ? "DEEP" : "PRIME");
  const keys = getProviderKeys();
  const primary = routeToProvider(mode, typeof messages.at(-1)?.content === "string" ? messages.at(-1).content : "");
  return await callWithFallbackStream(primary, messages, system, keys, !!opts.thinking, mode);
}

// ============================================================
// MEDIA GENERATION HELPERS
// Free/credit-first cascades for image and video generation.
// These are shared so mavis-image-gen, mavis-video-gen, and any
// future media functions all degrade gracefully through the same
// provider tiers. NSFW providers are never silently selected; they
// require an explicit provider:"promptchan" or nsfw:true request.
// ============================================================

export interface ImageGenOpts {
  prompt: string;
  size?: string;
  quality?: string;
  aspect_ratio?: string;
  width?: number;
  height?: number;
  provider?: string; // explicit provider override
  nsfw?: boolean;
}

export interface ImageGenResult {
  url: string;
  provider: string;
  notes: string[];
  revised_prompt?: string;
}

function parseImageDimensions(size?: string, width?: number, height?: number): [number, number] {
  if (width && height) return [width, height];
  const [w, h] = (size ?? "1024x1024").split("x").map(Number);
  return [w || 1024, h || 1024];
}

function normalizeOpenAiImageSize(size?: string): string {
  const allowed = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
  if (size && allowed.has(size)) return size;
  if (size === "1024x1792") return "1024x1536";
  if (size === "1792x1024") return "1536x1024";
  return "1024x1024";
}

function normalizeOpenAiImageQuality(quality?: string): string {
  const normalized = (quality ?? "low").toLowerCase();
  if (["low", "medium", "high", "auto"].includes(normalized)) return normalized;
  if (normalized === "hd") return "high";
  if (normalized === "standard") return "low";
  return "low";
}

function normalizeAspectRatio(size?: string, aspect_ratio?: string): string {
  if (aspect_ratio) return aspect_ratio;
  const [w, h] = parseImageDimensions(size);
  if (w === h) return "1:1";
  if (Math.abs(w / h - 16 / 9) < 0.05) return "16:9";
  if (Math.abs(w / h - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(w / h - 4 / 3) < 0.05) return "4:3";
  if (Math.abs(w / h - 3 / 4) < 0.05) return "3:4";
  return w > h ? "16:9" : "9:16";
}

async function lovableImage(prompt: string): Promise<string | null> {
  const key = getProviderKeys().lovable;
  if (!key) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image",
        messages: [{ role: "user", content: prompt.slice(0, 2000) }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      if (isUnfundedStatus(res.status, err)) throw new ProviderUnavailableError("lovable-image", err.slice(0, 200), res.status);
      throw new Error(`Lovable image ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    return b64 ? `data:image/png;base64,${b64}` : null;
  } catch (e) {
    throw e;
  }
}

function pollinationsImage(prompt: string, size?: string): string {
  const [w, h] = parseImageDimensions(size);
  const encoded = encodeURIComponent(prompt.trim().slice(0, 500));
  const seed = Math.floor(Date.now() % 100000);
  return `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&model=flux&nologo=true&enhance=true&seed=${seed}`;
}

async function imagen4Image(prompt: string, aspectRatio: string): Promise<string> {
  const key = getProviderKeys().gemini;
  if (!key) throw new ProviderUnavailableError("imagen-4", "GEMINI_API_KEY missing", 400);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-preview-06-06:predict?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: prompt.trim().slice(0, 2000) }],
        parameters: { sampleCount: 1, aspectRatio, safetyFilterLevel: "block_some" },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429 || res.status === 403) throw new ProviderUnavailableError("imagen-4", err.slice(0, 200), res.status);
    throw new Error(`Imagen 4 ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("Imagen 4 returned no image data");
  return `data:image/png;base64,${b64}`;
}

async function fluxProImage(prompt: string, size?: string): Promise<string> {
  const key = Deno.env.get("FAL_AI_API_KEY") ?? Deno.env.get("FAL_API_KEY") ?? "";
  if (!key) throw new ProviderUnavailableError("flux-pro", "FAL key missing", 400);
  const [w, h] = parseImageDimensions(size);
  const ratio = normalizeAspectRatio(size);
  const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1-ultra", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.trim().slice(0, 2000),
      aspect_ratio: ratio,
      num_images: 1,
      safety_tolerance: "6",
      output_format: "png",
      raw: false,
      enable_safety_checker: false,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FLUX Pro Ultra ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("FLUX Pro returned no image");
  return url;
}

async function openaiImage(prompt: string, size?: string, quality?: string): Promise<string> {
  const key = getProviderKeys().openai;
  if (!key) throw new ProviderUnavailableError("openai-image", "OpenAI key missing", 400);
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: prompt.trim(),
      n: 1,
      size: normalizeOpenAiImageSize(size),
      quality: normalizeOpenAiImageQuality(quality),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (isUnfundedStatus(res.status, err)) throw new ProviderUnavailableError("openai-image", err.slice(0, 200), res.status);
    throw new Error(`gpt-image-1 ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  const url = data.data?.[0]?.url;
  if (b64) return `data:image/png;base64,${b64}`;
  if (url) return url;
  throw new Error("gpt-image-1 returned no image");
}

async function modelsLabImage(prompt: string, size?: string): Promise<string> {
  const key = Deno.env.get("MODELSLAB_API_KEY") ?? "";
  if (!key) throw new ProviderUnavailableError("modelslab", "MODELSLAB_API_KEY missing", 400);
  const [w, h] = parseImageDimensions(size);
  const res = await fetch("https://modelslab.com/api/v6/realtime/text2img", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      prompt: prompt.trim().slice(0, 2000),
      negative_prompt: "blurry, low quality, watermark, text, deformed",
      width: String(w),
      height: String(h),
      samples: "1",
      safety_checker: "no",
      enhance_prompt: "yes",
    }),
  });
  if (!res.ok) throw new Error(`ModelsLab ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data?.status === "error") throw new Error("ModelsLab returned error status");
  const url = Array.isArray(data?.output) ? data.output[0] : data?.output;
  if (typeof url !== "string") throw new Error("ModelsLab returned no image URL");
  return url;
}

async function stableDiffusionImage(prompt: string, size?: string): Promise<string> {
  const url = Deno.env.get("STABLE_DIFFUSION_URL") ?? "";
  if (!url) throw new ProviderUnavailableError("stable-diffusion", "STABLE_DIFFUSION_URL missing", 400);
  const [w, h] = parseImageDimensions(size);
  const res = await fetch(`${url}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.slice(0, 1000),
      negative_prompt: "blurry, low quality, watermark, text, deformed, distorted",
      steps: 20,
      width: w,
      height: h,
      cfg_scale: 7,
      sampler_name: "DPM++ 2M",
      n_iter: 1,
      batch_size: 1,
    }),
  });
  if (!res.ok) throw new Error(`Stable Diffusion ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const b64 = data.images?.[0];
  if (!b64) throw new Error("Stable Diffusion returned no image");
  return `data:image/png;base64,${b64}`;
}

async function promptchanImage(prompt: string): Promise<string> {
  const key = Deno.env.get("PROMPTCHAN_API_KEY") ?? "";
  const base = Deno.env.get("PROMPTCHAN_API_BASE") ?? "https://prod.aicloudnetservices.com";
  if (!key) throw new ProviderUnavailableError("promptchan", "PROMPTCHAN_API_KEY missing", 400);
  const res = await fetch(`${base}/api/external/create`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt.trim().slice(0, 2000), style: "Hyperanime" }),
  });
  if (!res.ok) throw new Error(`PromptChan ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const b64 = data?.image;
  if (!b64) throw new Error("PromptChan returned no image data");
  return `data:image/png;base64,${b64}`;
}

/** Image generation cascade. Free/credit providers first, then paid fallbacks, then guaranteed-free Pollinations. */
export async function generateImageCascade(opts: ImageGenOpts): Promise<ImageGenResult> {
  const notes: string[] = [];
  const explicit = typeof opts.provider === "string" ? opts.provider.toLowerCase() : undefined;

  // Helper that catches ProviderUnavailableError and records a note, returning null.
  // fn may itself resolve to null — several image providers return null rather
  // than throwing when they have nothing to give. Declaring the parameter as
  // `() => Promise<string>` made every one of those call sites a type error
  // while the runtime handled them fine (the `if (url)` below already covers
  // null). Widened to match what the callers actually pass.
  const tryProvider = async (name: string, fn: () => Promise<string | null>): Promise<string | null> => {
    try {
      const url = await fn();
      if (url) return url;
      notes.push(`${name}: returned empty`);
      return null;
    } catch (e: any) {
      notes.push(`${name}: ${e.message ?? String(e)}`);
      return null;
    }
  };

  // Explicit provider override is honoured first, but if it fails we still
  // fall through to the cascade so a UI selection never becomes a hard failure.
  if (explicit && explicit !== "auto") {
    if (explicit === "lovable" || explicit === "gemini-image") {
      const url = await tryProvider("lovable", () => lovableImage(opts.prompt));
      if (url) return { url, provider: "lovable-ai", notes };
    } else if (explicit === "flux-pro" || explicit === "flux") {
      const url = await tryProvider("flux-pro", () => fluxProImage(opts.prompt, opts.size));
      if (url) return { url, provider: "flux-pro", notes };
    } else if (explicit === "imagen-4" || explicit === "imagen") {
      const url = await tryProvider("imagen-4", () => imagen4Image(opts.prompt, normalizeAspectRatio(opts.size, opts.aspect_ratio)));
      if (url) return { url, provider: "imagen-4", notes };
    } else if (explicit === "openai" || explicit === "gpt-image-1" || explicit === "dalle") {
      const url = await tryProvider("openai", () => openaiImage(opts.prompt, opts.size, opts.quality));
      if (url) return { url, provider: "openai-gpt-image-1", notes };
    } else if (explicit === "modelslab" || explicit === "seedream") {
      const url = await tryProvider("modelslab", () => modelsLabImage(opts.prompt, opts.size));
      if (url) return { url, provider: "modelslab", notes };
    } else if (explicit === "stable-diffusion" || explicit === "sd") {
      const url = await tryProvider("stable-diffusion", () => stableDiffusionImage(opts.prompt, opts.size));
      if (url) return { url, provider: "stable-diffusion", notes };
    } else if (explicit === "promptchan" || explicit === "nsfw") {
      const url = await tryProvider("promptchan", () => promptchanImage(opts.prompt));
      if (url) return { url, provider: "promptchan", notes };
    } else if (explicit === "pollinations") {
      return { url: pollinationsImage(opts.prompt, opts.size), provider: "pollinations-flux", notes };
    }
    notes.push(`${explicit}: unknown explicit provider; falling back to cascade`);
  }

  // Tier 1: Lovable AI Gateway (workspace-credit backed, high quality).
  const lovableUrl = await tryProvider("lovable", () => lovableImage(opts.prompt));
  if (lovableUrl) return { url: lovableUrl, provider: "lovable-ai", notes };

  // Tier 2: Free Gemini/Imagen when a direct free key is available.
  const geminiUrl = await tryProvider("imagen-4", () => imagen4Image(opts.prompt, normalizeAspectRatio(opts.size, opts.aspect_ratio)));
  if (geminiUrl) return { url: geminiUrl, provider: "imagen-4", notes };

  // Tier 3: Pollinations is always free and requires no keys.
  const pollinationsUrl = await tryProvider("pollinations", () => Promise.resolve(pollinationsImage(opts.prompt, opts.size)));
  if (pollinationsUrl) return { url: pollinationsUrl, provider: "pollinations-flux", notes };

  // Tier 4: Paid fallbacks (only attempted if their keys are configured).
  const fluxUrl = await tryProvider("flux-pro", () => fluxProImage(opts.prompt, opts.size));
  if (fluxUrl) return { url: fluxUrl, provider: "flux-pro", notes };

  const openaiUrl = await tryProvider("openai", () => openaiImage(opts.prompt, opts.size, opts.quality));
  if (openaiUrl) return { url: openaiUrl, provider: "openai-gpt-image-1", notes };

  const modelslabUrl = await tryProvider("modelslab", () => modelsLabImage(opts.prompt, opts.size));
  if (modelslabUrl) return { url: modelslabUrl, provider: "modelslab", notes };

  const sdUrl = await tryProvider("stable-diffusion", () => stableDiffusionImage(opts.prompt, opts.size));
  if (sdUrl) return { url: sdUrl, provider: "stable-diffusion", notes };

  // Tier 5: NSFW-capable explicit opt-in only.
  if (opts.nsfw) {
    const pcUrl = await tryProvider("promptchan", () => promptchanImage(opts.prompt));
    if (pcUrl) return { url: pcUrl, provider: "promptchan", notes };
  }

  throw new Error("All image providers unavailable. No LOVABLE_API_KEY, GEMINI_API_KEY, or paid keys configured, and no explicit provider succeeded.");
}

// ============================================================
// VIDEO GENERATION HELPERS
// ============================================================

export type VideoAspectRatio = "16:9" | "9:16" | "1:1";

export interface VideoGenOpts {
  prompt: string;
  duration?: number;
  aspect_ratio?: string;
  provider?: string;
  image_url?: string;
  model?: string;
}

export interface VideoGenResult {
  status: "processing" | "complete";
  url?: string;
  request_id?: string;
  operation_name?: string;
  poll_url?: string;
  provider: string;
  notes: string[];
  attempts?: Array<{ provider: string; error: string }>;
  /** Percent complete, when the provider reports it (promptchan does). */
  progress?: number;
}

function videoAspectRatio(aspect_ratio?: string): VideoAspectRatio {
  if (aspect_ratio === "16:9" || aspect_ratio === "9:16" || aspect_ratio === "1:1") return aspect_ratio;
  return "16:9";
}

async function veoVideoSubmit(prompt: string, aspect_ratio: VideoAspectRatio): Promise<{ operation_name: string; provider: string }> {
  const key = getProviderKeys().gemini;
  if (!key) throw new ProviderUnavailableError("veo", "GEMINI_API_KEY missing", 400);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:predictLongRunning?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: aspect_ratio, sampleCount: 1 } }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429 || res.status === 403) throw new ProviderUnavailableError("veo", err.slice(0, 200), res.status);
    throw new Error(`Veo submit ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const operation_name: string = data.name;
  if (!operation_name) throw new Error("Veo returned no operation name");
  return { operation_name, provider: "veo" };
}

export async function veoVideoPoll(operation_name: string): Promise<VideoGenResult> {
  const key = getProviderKeys().gemini;
  if (!key) throw new Error("GEMINI_API_KEY missing for Veo poll");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${operation_name}?key=${key}`,
    { headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok) throw new Error(`Veo poll ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.done) {
    if (data.error) throw new Error(`Veo operation failed: ${JSON.stringify(data.error)}`);
    const videoUri = data.response?.predictions?.[0]?.video?.uri ?? data.response?.predictions?.[0]?.videoUri;
    if (!videoUri) throw new Error("Veo operation done but no video URI found");
    return { status: "complete", url: videoUri, provider: "veo", notes: [] };
  }
  return { status: "processing", operation_name, provider: "veo", notes: [] };
}

async function falVideoSubmit(prompt: string, duration: number, aspect_ratio: VideoAspectRatio, model?: string): Promise<{ request_id: string; poll_url: string; provider: string }> {
  const key = Deno.env.get("FAL_API_KEY") ?? Deno.env.get("FAL_AI_API_KEY") ?? "";
  if (!key) throw new ProviderUnavailableError("fal", "FAL key missing", 400);
  const falModel = model ?? "fal-ai/veo3";
  const endpoint = `https://queue.fal.run/${falModel}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, duration, aspect_ratio }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai submit ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const request_id: string = data.request_id;
  if (!request_id) throw new Error("fal.ai returned no request_id");
  return { request_id, poll_url: `https://queue.fal.run/${falModel}/${request_id}`, provider: "fal" };
}

export async function falVideoPoll(request_id: string, model?: string): Promise<VideoGenResult> {
  const key = Deno.env.get("FAL_API_KEY") ?? Deno.env.get("FAL_AI_API_KEY") ?? "";
  const falModel = model ?? "fal-ai/veo3";
  const res = await fetch(`https://queue.fal.run/${falModel}/${request_id}`, { headers: { Authorization: `Key ${key}` } });
  if (!res.ok) throw new Error(`fal.ai poll ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.status === "COMPLETED" || data.video?.url) {
    const url = data.video?.url ?? data.output?.video?.url;
    if (!url) throw new Error("fal.ai job complete but no video URL found");
    return { status: "complete", url, provider: "fal", notes: [] };
  }
  if (data.status === "FAILED" || data.error) throw new Error(`fal.ai job failed: ${data.error ?? "unknown error"}`);
  return { status: "processing", request_id, provider: "fal", notes: [] };
}

async function klingVideoSubmit(prompt: string, duration: number, aspect_ratio: VideoAspectRatio): Promise<{ request_id: string; provider: string }> {
  const key = Deno.env.get("FAL_API_KEY") ?? Deno.env.get("FAL_AI_API_KEY") ?? "";
  if (!key) throw new ProviderUnavailableError("kling", "FAL key missing", 400);
  const res = await fetch("https://queue.fal.run/fal-ai/kling-video/v2.1/standard/text-to-video", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.slice(0, 2500),
      duration: String(Math.min(duration, 10)),
      aspect_ratio,
      negative_prompt: "blurry, low quality, watermark, text overlay, distorted",
    }),
  });
  if (!res.ok) throw new Error(`Kling submit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.request_id) throw new Error("Kling returned no request_id");
  return { request_id: data.request_id, provider: "kling" };
}

export async function klingVideoPoll(request_id: string): Promise<VideoGenResult> {
  const key = Deno.env.get("FAL_API_KEY") ?? Deno.env.get("FAL_AI_API_KEY") ?? "";
  const res = await fetch(
    `https://queue.fal.run/fal-ai/kling-video/v2.1/standard/text-to-video/${request_id}`,
    { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`Kling poll ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.status === "COMPLETED" || data.video?.url) {
    const url = data.video?.url ?? data.output?.video?.url;
    if (!url) throw new Error("Kling complete but no video URL");
    return { status: "complete", url, provider: "kling", notes: [] };
  }
  if (data.status === "FAILED") throw new Error(`Kling job failed: ${data.error ?? "unknown"}`);
  return { status: "processing", request_id, provider: "kling", notes: [] };
}

async function runwayVideoSubmit(prompt: string, aspect_ratio: VideoAspectRatio, image_url?: string): Promise<{ request_id: string; provider: string }> {
  const key = Deno.env.get("FAL_API_KEY") ?? Deno.env.get("FAL_AI_API_KEY") ?? "";
  if (!key) throw new ProviderUnavailableError("runway", "FAL key missing", 400);
  const ratioMap: Record<VideoAspectRatio, string> = { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960" };
  const res = await fetch("https://queue.fal.run/fal-ai/runway-gen3/turbo/image-to-video", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: prompt.slice(0, 1000),
      ratio: ratioMap[aspect_ratio] ?? "1280:720",
      ...(image_url ? { image_url } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Runway submit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.request_id) throw new Error("Runway returned no request_id");
  return { request_id: data.request_id, provider: "runway" };
}

export async function runwayVideoPoll(request_id: string): Promise<VideoGenResult> {
  const key = Deno.env.get("FAL_API_KEY") ?? Deno.env.get("FAL_AI_API_KEY") ?? "";
  const res = await fetch(
    `https://queue.fal.run/fal-ai/runway-gen3/turbo/image-to-video/${request_id}`,
    { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`Runway poll ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.status === "COMPLETED" || data.video?.url) {
    const url = data.video?.url ?? data.output?.url;
    if (!url) throw new Error("Runway complete but no video URL");
    return { status: "complete", url, provider: "runway", notes: [] };
  }
  if (data.status === "FAILED") throw new Error(`Runway job failed: ${data.error ?? "unknown"}`);
  return { status: "processing", request_id, provider: "runway", notes: [] };
}

async function modelsLabVideoSubmit(prompt: string, duration: number, aspect_ratio: VideoAspectRatio): Promise<VideoGenResult> {
  const key = Deno.env.get("MODELSLAB_API_KEY") ?? "";
  if (!key) throw new ProviderUnavailableError("modelslab", "MODELSLAB_API_KEY missing", 400);
  const ratioMap: Record<VideoAspectRatio, [number, number]> = {
    "16:9": [1024, 576],
    "9:16": [576, 1024],
    "1:1": [768, 768],
  };
  const [width, height] = ratioMap[aspect_ratio] ?? [1024, 576];
  const res = await fetch("https://modelslab.com/api/v6/video/text2video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      prompt: prompt.slice(0, 2000),
      negative_prompt: "blurry, low quality, watermark, distorted",
      width,
      height,
      num_frames: Math.min(Math.max(duration * 8, 16), 64),
      num_inference_steps: 20,
      guidance_scale: 7,
      output_type: "mp4",
    }),
  });
  if (!res.ok) throw new Error(`ModelsLab submit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data?.status === "success") {
    const url = Array.isArray(data.output) ? data.output[0] : data.output;
    return { status: "complete", url, provider: "modelslab", notes: [] };
  }
  if (data?.status === "processing") {
    return { status: "processing", request_id: String(data.id ?? data.fetch_result ?? ""), provider: "modelslab", notes: [] };
  }
  throw new Error(`ModelsLab error: ${data?.message ?? JSON.stringify(data).slice(0, 200)}`);
}

export async function modelsLabVideoPoll(request_id: string): Promise<VideoGenResult> {
  const key = Deno.env.get("MODELSLAB_API_KEY") ?? "";
  const fetchUrl = request_id.startsWith("http") ? request_id : `https://modelslab.com/api/v6/video/fetch/${request_id}`;
  const res = await fetch(fetchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ModelsLab poll ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data?.status === "success") {
    const url = Array.isArray(data.output) ? data.output[0] : data.output;
    return { status: "complete", url, provider: "modelslab", notes: [] };
  }
  if (data?.status === "processing") return { status: "processing", request_id, provider: "modelslab", notes: [] };
  throw new Error(`ModelsLab failed: ${data?.message ?? "unknown"}`);
}

async function promptchanVideoSubmit(prompt: string, aspect_ratio: VideoAspectRatio): Promise<{ request_id: string; provider: string }> {
  const key = Deno.env.get("PROMPTCHAN_API_KEY") ?? "";
  const base = Deno.env.get("PROMPTCHAN_API_BASE") ?? "https://prod.aicloudnetservices.com";
  if (!key) throw new ProviderUnavailableError("promptchan", "PROMPTCHAN_API_KEY missing", 400);
  const aspectMap: Record<VideoAspectRatio, string> = { "16:9": "Landscape", "9:16": "Portrait", "1:1": "Square" };
  const res = await fetch(`${base}/api/external/video_v4/submit`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt.trim(), aspect: aspectMap[aspect_ratio] ?? "Portrait" }),
  });
  if (!res.ok) throw new Error(`PromptChan video submit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.request_id) throw new Error("PromptChan returned no request_id");
  return { request_id: data.request_id, provider: "promptchan" };
}

export async function promptchanVideoPoll(request_id: string): Promise<VideoGenResult> {
  const key = Deno.env.get("PROMPTCHAN_API_KEY") ?? "";
  const base = Deno.env.get("PROMPTCHAN_API_BASE") ?? "https://prod.aicloudnetservices.com";
  const statusRes = await fetch(`${base}/api/external/video_v4/status_with_logs/${encodeURIComponent(request_id)}`, {
    headers: { "x-api-key": key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!statusRes.ok) throw new Error(`PromptChan video status ${statusRes.status}: ${(await statusRes.text()).slice(0, 200)}`);
  const statusData = await statusRes.json();
  const progress = Number(statusData?.progress ?? 0);
  const queueLength = Number(statusData?.current_queue_length ?? 0);
  if (queueLength > 0 && progress < 100) return { status: "processing", request_id, provider: "promptchan", notes: [], progress };

  const resultRes = await fetch(`${base}/api/external/video_v4/result/${encodeURIComponent(request_id)}`, {
    headers: { "x-api-key": key },
    signal: AbortSignal.timeout(15_000),
  });
  if (resultRes.ok) {
    const resultData = await resultRes.json();
    const url = Array.isArray(resultData?.video) ? resultData.video[0] : undefined;
    if (resultData?.status === "success" && url) return { status: "complete", url, provider: "promptchan", notes: [] };
  }
  return { status: "processing", request_id, provider: "promptchan", notes: [] };
}

/** Video generation cascade. Free Gemini Veo first, then paid fallbacks. */
export async function submitVideoCascade(opts: VideoGenOpts): Promise<VideoGenResult> {
  const attempts: Array<{ provider: string; error: string }> = [];
  const notes: string[] = [];
  const duration = opts.duration ?? 5;
  const aspect = videoAspectRatio(opts.aspect_ratio);
  const explicit = typeof opts.provider === "string" ? opts.provider.toLowerCase() : undefined;

  const tryProvider = async (name: string, fn: () => Promise<VideoGenResult>): Promise<VideoGenResult | null> => {
    try {
      const result = await fn();
      if (result.status === "complete" || result.status === "processing") return result;
      attempts.push({ provider: name, error: "empty result" });
      return null;
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ provider: name, error: msg });
      notes.push(`${name}: ${msg}`);
      return null;
    }
  };

  // If a provider is explicitly chosen, try it first, but still fall through on failure.
  if (explicit && explicit !== "auto") {
    if (explicit === "veo") {
      const r = await tryProvider("veo", async () => {
        const { operation_name } = await veoVideoSubmit(opts.prompt, aspect);
        return { status: "processing", operation_name, provider: "veo", notes: [] };
      });
      if (r) return { ...r, attempts };
    } else if (explicit === "fal") {
      const r = await tryProvider("fal", async () => {
        const { request_id, poll_url } = await falVideoSubmit(opts.prompt, duration, aspect, opts.model);
        return { status: "processing", request_id, poll_url, provider: "fal", notes: [] };
      });
      if (r) return { ...r, attempts };
    } else if (explicit === "kling") {
      const r = await tryProvider("kling", async () => {
        const { request_id } = await klingVideoSubmit(opts.prompt, duration, aspect);
        return { status: "processing", request_id, provider: "kling", notes: [] };
      });
      if (r) return { ...r, attempts };
    } else if (explicit === "runway") {
      const r = await tryProvider("runway", async () => {
        const { request_id } = await runwayVideoSubmit(opts.prompt, aspect, opts.image_url);
        return { status: "processing", request_id, provider: "runway", notes: [] };
      });
      if (r) return { ...r, attempts };
    } else if (explicit === "modelslab") {
      const r = await tryProvider("modelslab", async () => modelsLabVideoSubmit(opts.prompt, duration, aspect));
      if (r) return { ...r, attempts };
    } else if (explicit === "promptchan") {
      const r = await tryProvider("promptchan", async () => {
        const { request_id } = await promptchanVideoSubmit(opts.prompt, aspect);
        return { status: "processing", request_id, provider: "promptchan", notes: [] };
      });
      if (r) return { ...r, attempts };
    } else {
      notes.push(`${explicit}: unknown video provider; falling back to cascade`);
    }
  }

  // Tier 1: Free Gemini Veo (long-running, no per-request cost with free key).
  const veoResult = await tryProvider("veo", async () => {
    const { operation_name } = await veoVideoSubmit(opts.prompt, aspect);
    return { status: "processing", operation_name, provider: "veo", notes: [] };
  });
  if (veoResult) return { ...veoResult, attempts };

  // Tier 2: Paid credit-backed providers (fal.ai handles Veo, Kling, Runway).
  const falResult = await tryProvider("fal", async () => {
    const { request_id, poll_url } = await falVideoSubmit(opts.prompt, duration, aspect, opts.model);
    return { status: "processing", request_id, poll_url, provider: "fal", notes: [] };
  });
  if (falResult) return { ...falResult, attempts };

  const klingResult = await tryProvider("kling", async () => {
    const { request_id } = await klingVideoSubmit(opts.prompt, duration, aspect);
    return { status: "processing", request_id, provider: "kling", notes: [] };
  });
  if (klingResult) return { ...klingResult, attempts };

  const runwayResult = await tryProvider("runway", async () => {
    const { request_id } = await runwayVideoSubmit(opts.prompt, aspect, opts.image_url);
    return { status: "processing", request_id, provider: "runway", notes: [] };
  });
  if (runwayResult) return { ...runwayResult, attempts };

  // Tier 3: Subscription/key-gated providers.
  const modelsLabResult = await tryProvider("modelslab", async () => modelsLabVideoSubmit(opts.prompt, duration, aspect));
  if (modelsLabResult) return { ...modelsLabResult, attempts };

  const promptchanResult = await tryProvider("promptchan", async () => {
    const { request_id } = await promptchanVideoSubmit(opts.prompt, aspect);
    return { status: "processing", request_id, provider: "promptchan", notes: [] };
  });
  if (promptchanResult) return { ...promptchanResult, attempts };

  throw new Error("All video providers unavailable. No GEMINI_API_KEY, FAL_API_KEY, MODELSLAB_API_KEY, or PROMPTCHAN_API_KEY configured.");
}

// Mapping of provider names to poll functions for callers that need to poll long-running jobs.
export const videoPollHandlers: Record<string, (id: string, model?: string) => Promise<VideoGenResult>> = {
  veo: (id) => veoVideoPoll(id),
  fal: (id, model) => falVideoPoll(id, model),
  kling: (id) => klingVideoPoll(id),
  runway: (id) => runwayVideoPoll(id),
  modelslab: (id) => modelsLabVideoPoll(id),
  promptchan: (id) => promptchanVideoPoll(id),
};

