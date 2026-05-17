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
const TAVILY_KEY    = Deno.env.get("Tavily_API") ?? "";

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

// ── Break query into search angles via Haiku ──────────────────
async function planSearchAngles(query: string, depth: number): Promise<string[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: "You are a research planner. Return ONLY a JSON array of search query strings.",
      messages: [
        {
          role: "user",
          content: `Break this research query into exactly ${depth} distinct search angles that together give comprehensive coverage. Query: "${query}"`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic planner error: ${res.status}`);
  const data  = await res.json();
  const text  = data.content?.[0]?.text ?? "[]";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Failed to parse search angles from Claude response");
  return JSON.parse(match[0]) as string[];
}

// ── Tavily search ─────────────────────────────────────────────
interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

async function tavilySearch(angle: string): Promise<TavilyResult[]> {
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
  });
  if (!res.ok) {
    console.error(`[mavis-deep-research] Tavily error for angle "${angle}": ${res.status}`);
    return [];
  }
  const data = await res.json();
  return (data.results ?? []) as TavilyResult[];
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

  // Check Tavily key early
  if (!TAVILY_KEY) {
    const note = "Web search isn't configured (Tavily_API key missing). Please add the Tavily_API secret to proceed with deep research.";
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
          const results = await tavilySearch(angle);
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

      // Step 4: synthesize via Claude Sonnet (streaming)
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
          system: "You are a research analyst. Write a comprehensive, well-structured markdown report based on the provided sources.",
          messages: [
            {
              role: "user",
              content: `Research query: "${query}"\n\nSources:\n${context}\n\nWrite a structured markdown report with:\n## Research Report\n### Key Findings\n### Sources (numbered list with URLs)\n### Conclusion`,
            },
          ],
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
