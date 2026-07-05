// SKILL: slidespeak
// Generate and analyze presentations via Apify MCP server agentify/slidespeak-mcp-server.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "slidespeak", output: "Generate presentations. Example: 'create presentation: Q4 sales review 10 slides' or 'slidespeak: product launch deck' or 'analyze slides: https://example.com/deck.pdf'" };
  }
  const prompt = input.replace(/^(create presentation|slidespeak|generate slides)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "agentify/slidespeak-mcp-server", input: { prompt, user_id: ctx.userId }, timeout: 120 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.presentation ?? data;
    return { skillName: "slidespeak", output: result ? `📊 **SlideSpeak Presentation:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "slidespeak", output: `SlideSpeak error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "slidespeak",
  description: "Generate AI-powered presentations and analyze existing decks via SlideSpeak",
  keywords: [
    "slidespeak", "create presentation", "generate slides", "ai presentation",
    "make slides", "presentation generator", "slide deck ai",
  ],
}, handler);
