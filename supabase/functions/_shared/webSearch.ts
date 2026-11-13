// _shared/webSearch.ts
// Web-search helpers shared by every chat surface (mavis-chat, mavis-persona-router): the Tavily call and the
// "does this message want the live web?" heuristic. Lived in mavis-chat/promptBuilder.ts, which left council and
// persona chats with no search at all.

// ============================================================
// TAVILY WEB SEARCH
// ============================================================
export async function tavilySearch(query: string, key: string): Promise<string> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, search_depth: "basic", max_results: 5 }),
      signal: AbortSignal.timeout(8000), // a hung search must never hold up a spoken reply
    });
    if (!res.ok) return "";
    const data = await res.json();
    if (!data.results?.length) return "";
    return `\n[WEB SEARCH RESULTS for "${query}"]\n` +
      data.results.map((r: any, i: number) =>
        `[${i + 1}] ${r.title}\n${r.content?.slice(0, 400)}\nSource: ${r.url}`
      ).join("\n\n") + "\n";
  } catch { return ""; }
}

export function needsWebSearch(msg: string): boolean {
  const lower = msg.toLowerCase();
  // "search my journal" is an in-app search (search_app), not a web one.
  if (/\b(my|the) (journal|vault|notes|quests?|skills?|memory|memories|calendar|inbox|emails?)\b/.test(lower) && /\bsearch\b/.test(lower) && !/\b(web|internet|google|online)\b/.test(lower)) return false;
  return [
    "search for","look up","what is happening","current events","latest news",
    "today's","right now","real-time","search the web","find out about","what's new",
    "recent news","breaking news","weather","stock price","trending",
    "google","find me","search the internet","look this up","pull up",
    "what's happening","who is","what is the latest","current price",
    "news about","tell me about the latest","up to date","most recent",
    "search","latest","news","on the web","internet","price of","how much is","forecast",
  ].some((t) => lower.includes(t));
}

