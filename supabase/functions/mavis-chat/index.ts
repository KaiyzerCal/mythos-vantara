import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Provider endpoints ─────────────────────────────────────
const OPENAI_URL   = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const XAI_URL      = "https://api.x.ai/v1/chat/completions";
const LOVABLE_URL  = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Provider = "openai" | "anthropic" | "xai" | "lovable";

interface ModelRoute {
  provider: Provider;
  model: string;
}

// ── Model routing per mode ─────────────────────────────────
const MODE_MODEL_MAP: Record<string, ModelRoute> = {
  PRIME:      { provider: "openai",    model: "gpt-4o-mini" },
  ARCH:       { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  QUEST:      { provider: "openai",    model: "gpt-4o-mini" },
  FORGE:      { provider: "openai",    model: "gpt-4o-mini" },
  CODEX:      { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  SOVEREIGN:  { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  ENRYU:      { provider: "openai",    model: "gpt-4o-mini" },
  WATCHTOWER: { provider: "xai",       model: "grok-3-mini" },
};

const DEFAULT_ROUTE: ModelRoute = { provider: "openai", model: "gpt-4o-mini" };

// ── Get API key for provider ───────────────────────────────
function getKeyAndUrl(provider: Provider): { apiKey: string; apiUrl: string } {
  switch (provider) {
    case "anthropic": {
      const k = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!k) throw new Error("ANTHROPIC_API_KEY not set");
      return { apiKey: k, apiUrl: ANTHROPIC_URL };
    }
    case "xai": {
      const k = Deno.env.get("XAI_API_KEY") ?? "";
      if (!k) throw new Error("XAI_API_KEY not set");
      return { apiKey: k, apiUrl: XAI_URL };
    }
    case "openai": {
      const k = Deno.env.get("OPENAI_API_KEY") ?? "";
      if (!k) throw new Error("OPENAI_API_KEY not set");
      return { apiKey: k, apiUrl: OPENAI_URL };
    }
    case "lovable": {
      const k = Deno.env.get("LOVABLE_API_KEY") ?? "";
      if (!k) throw new Error("LOVABLE_API_KEY not set");
      return { apiKey: k, apiUrl: LOVABLE_URL };
    }
  }
}

// ── Tavily web search ──────────────────────────────────────
async function tavilySearch(query: string): Promise<string> {
  const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");
  if (!TAVILY_API_KEY) {
    console.warn("TAVILY_API_KEY not set, skipping web search");
    return "";
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: "basic", max_results: 5 }),
    });
    if (!res.ok) { console.error("Tavily error:", res.status, await res.text()); return ""; }
    const data = await res.json();
    if (!data.results?.length) return "";
    return `\n[WEB SEARCH RESULTS for "${query}"]\n` +
      data.results.map((r: any, i: number) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`).join("\n\n") + "\n";
  } catch (e) { console.error("Tavily search failed:", e); return ""; }
}

// ── Detect if message needs web search ────────────────────
function needsWebSearch(message: string): string | null {
  const lower = message.toLowerCase();
  const triggers = [
    "search for", "look up", "what is happening", "current events",
    "latest news", "today's", "right now", "real-time", "realtime",
    "search the web", "google", "find out about", "what's new",
    "recent news", "breaking news", "weather", "stock price",
    "score", "election", "trending", "latest", "current",
  ];
  return triggers.some((t) => lower.includes(t)) ? message : null;
}

// ── Auto-detect Grok routing for real-time queries ────────
function shouldForceGrok(message: string): boolean {
  const lower = message.toLowerCase();
  const grokTriggers = [
    "what is happening", "real-time", "realtime", "live update",
    "right now", "breaking", "trending", "current events",
    "latest news", "what's going on", "today's news",
  ];
  return grokTriggers.some((t) => lower.includes(t));
}

// ── Call Anthropic (Messages API) ─────────────────────────
async function callAnthropic(apiKey: string, model: string, systemPrompt: string, messages: any[]): Promise<string> {
  const anthropicMessages = messages.map((m: any) => ({ role: m.role === "system" ? "user" : m.role, content: m.content }));

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: anthropicMessages,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Anthropic API error:", res.status, err);
    if (res.status === 429) throw { status: 429, message: "Rate limited — please wait and try again." };
    throw new Error(`Anthropic API error: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "No response generated.";
}

// ── Call OpenAI-compatible API (OpenAI / xAI / Lovable) ───
async function callOpenAICompatible(apiKey: string, apiUrl: string, model: string, systemPrompt: string, messages: any[]): Promise<string> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m: any) => ({ role: m.role, content: m.content })),
      ],
      max_completion_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`${apiUrl} error:`, res.status, err);
    if (res.status === 429) throw { status: 429, message: "Rate limited — please wait and try again." };
    if (res.status === 402) throw { status: 402, message: "AI credits exhausted. Add funds in Settings → Workspace → Usage." };
    throw new Error(`AI API error: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "No response generated.";
}

// ── Main handler ──────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, systemPrompt, mode, conversationId } = await req.json();

    // ── Resolve route (with auto-Grok detection) ──
    let route = MODE_MODEL_MAP[mode] ?? DEFAULT_ROUTE;

    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
    if (lastUserMsg && shouldForceGrok(lastUserMsg.content)) {
      const xaiKey = Deno.env.get("XAI_API_KEY");
      if (xaiKey) {
        route = { provider: "xai", model: "grok-3-mini" };
        console.log(`[mavis-chat] Auto-routing to Grok for real-time query`);
      }
    }

    console.log(`[mavis-chat] mode=${mode} → provider=${route.provider} model=${route.model}`);

    // ── Tavily search if needed ──
    let webSearchResults = "";
    if (lastUserMsg) {
      const searchQuery = needsWebSearch(lastUserMsg.content);
      if (searchQuery) webSearchResults = await tavilySearch(searchQuery);
    }

    const fullSystemPrompt = webSearchResults
      ? `${systemPrompt}\n\n---\nWEB SEARCH RESULTS (use these to answer the user's current query):\n${webSearchResults}\n---`
      : systemPrompt;

    // ── Route to the correct provider ──
    const { apiKey, apiUrl } = getKeyAndUrl(route.provider);
    let content: string;

    if (route.provider === "anthropic") {
      content = await callAnthropic(apiKey, route.model, fullSystemPrompt, messages);
    } else {
      content = await callOpenAICompatible(apiKey, apiUrl, route.model, fullSystemPrompt, messages);
    }

    return new Response(
      JSON.stringify({
        content,
        mode,
        model: route.model,
        provider: route.provider,
        conversationId,
        searched: !!webSearchResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mavis-chat error:", err);
    const status = err.status ?? 500;
    return new Response(
      JSON.stringify({ error: err.message ?? String(err) }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
