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
//   0a. Gemini 2.0 Flash      (free tier, 15 RPM)
//   0b. Gemini 2.0 Flash Lite (free tier, 30 RPM, separate quota)
//   1.  Gemini 2.5 Flash preview (paid, mode-specific tools)
//   2.  Mode-designated provider (Claude Sonnet for ARCH/CODEX, Grok for WATCHTOWER)
//   3.  OpenAI gpt-4o-mini
//   4.  Claude Haiku
//   5.  Claude Sonnet
//   6.  Grok (last resort)
export async function callWithFallback(
  primary: Provider,
  messages: any[],
  system: string,
  keys: { openai: string; claude: string; grok: string; gemini: string; groq: string },
  useThinking = false,
  mode = "PRIME",
): Promise<{ content: string; provider: string }> {
  const mU = mode.toUpperCase();

  // Tier 0a — Free Gemini 2.0 Flash (no per-token cost, 15 RPM limit)
  // Skip for DEEP (thinking) mode — only 2.5 supports thinkingConfig.
  if (keys.gemini && mU !== "DEEP" && !isProviderUnhealthy("gemini-2.0-flash")) {
    try {
      return { content: await callGemini(messages, system, keys.gemini, { model: "gemini-2.0-flash" }), provider: "gemini-2.0-flash" };
    } catch (err: any) {
      if (err instanceof ProviderUnavailableError) {
        markProviderUnhealthy("gemini-2.0-flash", err.status === 429 ? 60_000 : 120_000);
      }
      console.warn(`[fallback] gemini-2.0-flash failed (${err.message}) → trying flash-lite`);
    }
  }

  // Tier 0b — Free Gemini 2.0 Flash Lite (separate rate-limit pool, 30 RPM)
  if (keys.gemini && mU !== "DEEP" && !isProviderUnhealthy("gemini-2.0-flash-lite")) {
    try {
      return { content: await callGemini(messages, system, keys.gemini, { model: "gemini-2.0-flash-lite" }), provider: "gemini-2.0-flash-lite" };
    } catch (err: any) {
      if (err instanceof ProviderUnavailableError) {
        markProviderUnhealthy("gemini-2.0-flash-lite", err.status === 429 ? 60_000 : 120_000);
      }
      console.warn(`[fallback] gemini-2.0-flash-lite failed (${err.message}) → escalating to paid tier`);
    }
  }

  // Tier 0c — Groq Llama 3.3 70B (~500 tok/s, generous free tier, no thinking overhead)
  if (keys.groq && mU !== "DEEP" && !isProviderUnhealthy("groq-llama")) {
    try {
      return { content: await callGroq(messages, system, keys.groq), provider: "groq-llama-70b" };
    } catch (err: any) {
      if (err instanceof ProviderUnavailableError) markProviderUnhealthy("groq-llama", 60_000);
      console.warn(`[fallback] Groq failed (${err.message}) → cascading`);
    }
  }

  // Tier 1 — Gemini 2.5 Flash (paid; supports thinking, grounding, code-exec)
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
      console.warn(`[fallback] Gemini 2.5 Flash failed (${err.message}) → cascading`);
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

// ── Groq (Llama 3.3 70B — ~500 tok/s, generous free tier) ─────────────────
export async function callGroq(messages: any[], system: string, key: string, model = "llama-3.3-70b-versatile"): Promise<string> {
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

export async function callGroqStream(messages: any[], system: string, key: string, model = "llama-3.3-70b-versatile"): Promise<ReadableStream<string>> {
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
  keys: { openai: string; claude: string; grok: string; gemini: string; groq: string },
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
  // Tier 0b — Groq (fast Llama 3.3 70B, ~500 tok/s)
  if (keys.groq && mU !== "DEEP" && !isProviderUnhealthy("groq-llama")) {
    try { return { stream: await callGroqStream(messages, system, keys.groq), provider: "groq-llama-70b" }; }
    catch (e: any) {
      if (e instanceof ProviderUnavailableError) markProviderUnhealthy("groq-llama", 60_000);
      console.warn(`[stream-fallback] Groq: ${e.message} → cascading`);
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
