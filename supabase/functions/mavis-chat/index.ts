import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

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

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
      throw new Error(`AI API error: ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "No response generated.";

    return new Response(
      JSON.stringify({
        content,
        mode,
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
