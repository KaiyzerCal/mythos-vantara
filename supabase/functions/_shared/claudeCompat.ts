// Drop-in replacements for direct Anthropic calls, so a function written against api.anthropic.com keeps working
// when Claude credits run out (which is what happened: ~30 functions called Anthropic with no fallback and went
// silently dead — Design Studio, Website Builder, Intelligence's strategy council, expense categorizing, ...).
//
//   claudeFetch(url, init)      — same signature as fetch(). A plain-text /v1/messages request is answered by the shared
//                                 cascade (free tiers first) and returned as a Response in Anthropic's shape. Anything the
//                                 cascade cannot express (tools, streaming, image/document blocks, other endpoints) is
//                                 passed straight to the real fetch, exactly as before.
//   claudeCreate(params)        — same as `anthropic.messages.create(params)` for the SDK-style callers; text only.
//   claudeFetchBg / claudeCreateBg — the same for scheduled jobs: background lane, so the watchdog's cost guard can pause them.
//
// Not honoured on the cascade path: temperature, and the output cap is the provider's own (Gemini ~4k, others ~8k).

import { aiComplete } from "./providers.ts";

type Block = { type?: string; text?: string };

function flatten(content: unknown): string | null {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content) && content.every((b: Block) => b?.type === "text" && typeof b.text === "string")) {
    return content.map((b: Block) => b.text).join("\n");
  }
  return null; // images, documents, tool blocks, ...
}

interface Plain { system: string; messages: { role: "user" | "assistant"; content: string }[]; thinking: boolean }

/** The request reduced to plain text, or null if it needs real Claude features. */
function toPlain(body: any): Plain | null {
  if (!body || body.stream || body.tools || body.tool_choice || !Array.isArray(body.messages)) return null;
  const system = flatten(body.system);
  if (system === null) return null;
  const messages: Plain["messages"] = [];
  for (const m of body.messages) {
    const text = flatten(m?.content);
    if (text === null || (m.role !== "user" && m.role !== "assistant")) return null;
    messages.push({ role: m.role, content: text });
  }
  if (!messages.length || messages[0].role !== "user") return null;
  return { system, messages, thinking: !!body.thinking };
}

const message = (text: string, model: string) => ({
  id: `msg_cascade_${crypto.randomUUID()}`, type: "message", role: "assistant", model,
  content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 0, output_tokens: 0 },
});

async function run(plain: Plain, background: boolean) {
  return await aiComplete({ system: plain.system, messages: plain.messages, thinking: plain.thinking, premiumFirst: !background });
}

function make(background: boolean) {
  async function claudeFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const u = String(url);
    let plain: Plain | null = null;
    if (/^https:\/\/api\.anthropic\.com\/v1\/messages\/?$/.test(u) && typeof init.body === "string") {
      try { plain = toPlain(JSON.parse(init.body)); } catch { plain = null; }
    }
    if (!plain) return fetch(url, init);
    try {
      const r = await run(plain, background);
      return new Response(JSON.stringify(message(r.content, r.provider)), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      return new Response(
        JSON.stringify({ type: "error", error: { type: "overloaded_error", message: e instanceof Error ? e.message : String(e) } }),
        { status: 529, headers: { "content-type": "application/json" } },
      );
    }
  }

  async function claudeCreate(params: any): Promise<any> {
    const plain = toPlain(params);
    if (!plain) throw new Error("claudeCreate: request needs tools, streaming or non-text content, which the cascade cannot serve");
    const r = await run(plain, background);
    return message(r.content, r.provider);
  }

  return { claudeFetch, claudeCreate };
}

export const { claudeFetch, claudeCreate } = make(false);
export const { claudeFetch: claudeFetchBg, claudeCreate: claudeCreateBg } = make(true);
