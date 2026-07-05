// SKILL: exa-search
// Semantic AI-powered web search via mavis-exa-agent (Exa.ai — far better than keyword search).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "exa-search", output: "Semantic search the web with AI understanding. Example: 'exa search for best practices in React state management' or 'find articles about longevity science 2025'" };
  }
  const query = input.replace(/^(exa search|exa find|semantic search|intelligent search|find articles?)\s+(for\s+|about\s+)?/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-exa-agent", {
      body: { query, num_results: 6, type: "neural", use_autoprompt: true },
    });
    if (error) throw error;
    const results = data?.results ?? data?.items ?? [];
    if (Array.isArray(results) && results.length > 0) {
      const formatted = results.slice(0, 5).map((r: any, i: number) =>
        `**${i + 1}. [${r.title ?? "Untitled"}](${r.url})**\n${(r.text ?? r.snippet ?? r.summary ?? "").slice(0, 300)}`
      ).join("\n\n");
      return { skillName: "exa-search", output: `🔍 **Exa Search: "${query}"**\n\n${formatted}` };
    }
    return { skillName: "exa-search", output: data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "exa-search", output: `Exa search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "exa-search",
  description: "AI-powered semantic web search that understands meaning, not just keywords",
  keywords: [
    "exa search", "semantic search", "intelligent search", "neural search",
    "find articles about", "search for similar", "find pages about",
    "what people are saying about", "find sources on",
  ],
}, handler);
