// SKILL: reddit-sentiment
// Analyzes Reddit sentiment for a keyword, brand, or product via Apify.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const query = input?.replace(/^\/?(reddit sentiment|reddit analysis|reddit opinion)\s*:?\s*/i, "").trim() || "";
  if (!query) {
    return { skillName: "reddit-sentiment", output: "Please tell me what keyword, brand, product, or topic to analyze on Reddit (e.g., \"reddit sentiment: Tesla\")." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: {
        actorId: "nextapi/reddit-user-analyzer",
        input: { searchTerms: [query], maxResults: 50 },
        timeout: 60,
      },
    });
    if (error) throw error;
    const result = data?.output ?? data?.items ?? data;
    return {
      skillName: "reddit-sentiment",
      output: result
        ? `🤖 **Reddit Sentiment — ${query}:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}`
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "reddit-sentiment", output: `Reddit sentiment error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "reddit-sentiment",
  description: "Analyzes Reddit sentiment and discussions for a keyword, brand, product, or topic",
  keywords: [
    "reddit sentiment", "reddit opinion", "reddit analysis", "reddit buzz",
    "what does reddit think", "reddit discussion", "reddit research",
  ],
}, handler);
