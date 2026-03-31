import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Model routing per mode ─────────────────────────────────
const MODE_MODEL_MAP: Record<string, { provider: "lovable" | "openai"; model: string }> = {
  PRIME:     { provider: "lovable", model: "openai/gpt-5-mini" },        // Full-spectrum — strong reasoning
  ARCH:      { provider: "lovable", model: "google/gemini-2.5-pro" },    // Architecture — deep analysis
  QUEST:     { provider: "lovable", model: "google/gemini-3-flash-preview" }, // Quick execution focus
  FORGE:     { provider: "lovable", model: "google/gemini-2.5-flash" },  // Fitness — fast & capable
  CODEX:     { provider: "lovable", model: "google/gemini-2.5-pro" },    // Knowledge — deep patterns
  SOVEREIGN: { provider: "openai",  model: "gpt-4o" },                   // High-stakes — premium OpenAI
};

const DEFAULT_ROUTE = { provider: "lovable" as const, model: "google/gemini-3-flash-preview" };

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// ── Tavily web search ──────────────────────────────────────
async function tavilySearch(query: string): Promise<string> {
  const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY");
  if (!TAVILY_API_KEY) {
    console.warn("TAVILY_API_KEY secret not set, skipping web search");
    return "";
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
      }),
    });
    if (!res.ok) {
      console.error("Tavily error:", res.status, await res.text());
      return "";
    }
    const data = await res.json();
    if (!data.results || data.results.length === 0) return "";
    const summary = data.results
      .map(
        (r: any, i: number) =>
          `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`
      )
      .join("\n\n");
    return `\n[WEB SEARCH RESULTS for "${query}"]\n${summary}\n`;
  } catch (e) {
    console.error("Tavily search failed:", e);
    return "";
  }
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
  if (triggers.some((t) => lower.includes(t))) return message;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, systemPrompt, mode, conversationId } = await req.json();

    // ── Resolve model route ──
    const route = MODE_MODEL_MAP[mode] ?? DEFAULT_ROUTE;
    console.log(`[mavis-chat] mode=${mode} → provider=${route.provider} model=${route.model}`);

    // ── Resolve API key ──
    let apiKey: string;
    let apiUrl: string;

    if (route.provider === "lovable") {
      apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
      apiUrl = LOVABLE_GATEWAY;
      if (!apiKey) throw new Error("LOVABLE_API_KEY not set");
    } else {
      apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
      apiUrl = OPENAI_API_URL;
      if (!apiKey) {
        // Fallback to Lovable gateway if no OpenAI key
        console.warn("OPENAI_API_KEY not set, falling back to Lovable gateway");
        apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
        apiUrl = LOVABLE_GATEWAY;
        if (!apiKey) throw new Error("No API key available");
      }
    }

    // ── Tavily search if needed ──
    let webSearchResults = "";
    const lastUserMsg = [...messages]
      .reverse()
      .find((m: any) => m.role === "user");
    if (lastUserMsg) {
      const searchQuery = needsWebSearch(lastUserMsg.content);
      if (searchQuery) {
        webSearchResults = await tavilySearch(searchQuery);
      }
    }

    // ── Inject search results into system prompt ──
    const fullSystemPrompt = webSearchResults
      ? `${systemPrompt}\n\n---\nWEB SEARCH RESULTS (use these to answer the user's current query):\n${webSearchResults}\n---`
      : systemPrompt;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: route.model,
        messages: [
          { role: "system", content: fullSystemPrompt },
          ...messages.map((m: any) => ({
            role: m.role,
            content: m.content,
          })),
        ],
        max_completion_tokens: 2048,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("AI API error:", response.status, err);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw new Error(`AI API error: ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "No response generated.";

    return new Response(
      JSON.stringify({
        content,
        mode,
        model: route.model,
        conversationId,
        searched: !!webSearchResults,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("mavis-chat error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
