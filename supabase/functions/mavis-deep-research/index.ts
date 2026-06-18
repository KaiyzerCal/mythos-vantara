// MAVIS Deep Research — multi-step research synthesis
// Takes a query, runs multiple web searches via Tavily, synthesizes into a markdown report streamed via SSE.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_KEY    = Deno.env.get("GEMINI_API_KEY") ?? "";
const TAVILY_KEY    = Deno.env.get("Tavily_API") ?? "";
// Self-hosted SearXNG meta-search engine. No API key needed.
// Deploy: docker run -d -p 8888:8080 searxng/searxng  |  set SEARXNG_URL=http://your-server:8888
const SEARXNG_URL   = Deno.env.get("SEARXNG_URL") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── JWT auth ───────────────────────────────────────────────────
async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth  = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const secret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (secret) {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const b64        = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded     = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig        = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const valid      = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (!valid) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload    = JSON.parse(atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload.sub ?? null;
    }
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Shared LLM helper: Gemini → Anthropic cascade ─────
async function callAI(system: string, userMsg: string, maxTokens = 512): Promise<string> {
  // Tier 0 — Free Gemini
  if (GEMINI_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: userMsg }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      });
      if (res.ok) { const d = await res.json(); const t = d.candidates?.[0]?.content?.parts?.[0]?.text ?? ""; if (t) return t; }
    } catch { /* fall through */ }
  }
  // Tier 1 — Anthropic Haiku (designated)
  if (ANTHROPIC_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system, messages: [{ role: "user", content: userMsg }] }),
    });
    if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
    const d = await res.json();
    return d.content?.[0]?.text ?? "";
  }
  throw new Error("No LLM provider available");
}

// ── Break query into search angles ────────────────────────────
async function planSearchAngles(query: string, depth: number): Promise<string[]> {
  const text = await callAI(
    "You are a research planner. Return ONLY a JSON array of search query strings.",
    `Break this research query into exactly ${depth} distinct search angles that together give comprehensive coverage. Query: "${query}"`,
    512,
  );
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Failed to parse search angles from planner response");
  return JSON.parse(match[0]) as string[];
}

// ── Search providers ──────────────────────────────────────────
interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

async function tavilySearch(angle: string): Promise<TavilyResult[]> {
  if (!TAVILY_KEY) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: angle,
        search_depth: "advanced",
        max_results: 3,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}

async function searxngSearch(angle: string): Promise<TavilyResult[]> {
  if (!SEARXNG_URL) return [];
  try {
    const params = new URLSearchParams({ q: angle, format: "json", categories: "general", language: "en" });
    const res = await fetch(`${SEARXNG_URL}/search?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.results ?? []) as any[]).slice(0, 5).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? r.snippet ?? "",
    }));
  } catch {
    return [];
  }
}

// Tries Tavily first (higher quality), falls back to self-hosted SearXNG.
async function webSearch(angle: string): Promise<TavilyResult[]> {
  const results = await tavilySearch(angle);
  if (results.length > 0) return results;
  return searxngSearch(angle);
}

// ── Build context string from results ────────────────────────
function buildContext(allResults: TavilyResult[]): string {
  return allResults
    .map((r, i) =>
      `[${i + 1}] ${r.title}\nURL: ${r.url}\n${(r.content ?? "").slice(0, 400)}`
    )
    .join("\n\n---\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const query = String(body.query ?? "").trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "query is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawDepth = Number(body.depth ?? 3);
  const depth    = Math.max(1, Math.min(5, isNaN(rawDepth) ? 3 : rawDepth));

  // Require at least one search provider
  if (!TAVILY_KEY && !SEARXNG_URL) {
    const note = "Web search isn't configured. Add Tavily_API (cloud) or SEARXNG_URL (self-hosted) to enable deep research.";
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ token: note })}\n\n`));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Build the SSE stream using a TransformStream so we can await async work
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  const sendToken = async (token: string) => {
    await writer.write(enc.encode(`data: ${JSON.stringify({ token })}\n\n`));
  };

  // Run research pipeline in the background
  (async () => {
    try {
      // Step 1: plan search angles
      await sendToken("Planning research angles...\n\n");
      const angles = await planSearchAngles(query, depth);

      // Step 2: search each angle
      await sendToken(`Searching ${angles.length} angles...\n\n`);
      const allResults: TavilyResult[] = [];
      for (const angle of angles) {
        try {
          const results = await webSearch(angle);
          allResults.push(...results);
        } catch (e) {
          console.error("[mavis-deep-research] Tavily angle error:", e);
        }
      }

      if (allResults.length === 0) {
        await sendToken("No search results found. Please refine your query.\n\n");
        await writer.write(enc.encode("data: [DONE]\n\n"));
        await writer.close();
        return;
      }

      // Step 3: build context
      const context = buildContext(allResults);

      // Step 4: synthesize — Gemini first (non-streaming), then Claude Sonnet (streaming)
      const synthSystem = "You are a research analyst. Write a comprehensive, well-structured markdown report based on the provided sources.";
      const synthUser   = `Research query: "${query}"\n\nSources:\n${context}\n\nWrite a structured markdown report with:\n## Research Report\n### Key Findings\n### Sources (numbered list with URLs)\n### Conclusion`;

      let synthesisHandled = false;
      if (GEMINI_KEY) {
        try {
          const lvRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: synthSystem }] },
              contents: [{ role: "user", parts: [{ text: synthUser }] }],
              generationConfig: { maxOutputTokens: 4096 },
            }),
          });
          if (lvRes.ok) {
            const lvData = await lvRes.json();
            const lvText = lvData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (lvText) { await sendToken(lvText); synthesisHandled = true; }
          }
        } catch { /* fall through to Claude */ }
      }

      if (!synthesisHandled) {
      const synthesisRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "messages-2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          stream: true,
          system: synthSystem,
          messages: [{ role: "user", content: synthUser }],
        }),
      });

      if (!synthesisRes.ok || !synthesisRes.body) {
        const errText = await synthesisRes.text();
        throw new Error(`Claude synthesis error ${synthesisRes.status}: ${errText}`);
      }

      // Stream Anthropic SSE → our SSE
      const reader = synthesisRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            const delta = event?.delta?.text;
            if (delta) {
              await sendToken(delta);
            }
          } catch { /* skip malformed events */ }
        }
      }
      } // end if (!synthesisHandled)

      await writer.write(enc.encode("data: [DONE]\n\n"));
      await writer.close();
    } catch (err) {
      console.error("[mavis-deep-research] Pipeline error:", err);
      try {
        const msg = err instanceof Error ? err.message : String(err);
        await sendToken(`\n\n**Error:** ${msg}`);
        await writer.write(enc.encode("data: [DONE]\n\n"));
        await writer.close();
      } catch { /* writer already closed */ }
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
