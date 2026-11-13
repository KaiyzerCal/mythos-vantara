// The Tavily secret has been created under different names over time ("Tavily_API", "TAVILY_API_KEY", "TAVILY_KEY"),
// and each function used to read just one of them — so setting the key under the "wrong" name left some functions
// (chat, the voice relay) unable to search while others worked. Every function reads it through here.
const NAMES = ["TAVILY_API_KEY", "Tavily_API", "TAVILY_KEY", "TAVILY_API", "Tavily_API_Key", "TAVILY_APIKEY"];

export function getTavilyKey(): string {
  for (const n of NAMES) {
    const v = Deno.env.get(n);
    if (v && v.trim()) return v.trim();
  }
  return "";
}
