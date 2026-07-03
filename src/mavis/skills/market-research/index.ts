// SKILL: market-research
// Triggers a deep multi-step research pass via mavis-deep-research.
// Pattern adapted from 500-AI-Agents-Projects #01 (web research agent).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return {
      skillName: "market-research",
      output: "What topic should I research? Give me a specific question or area and I'll run a deep multi-source research pass.",
    };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-deep-research", {
      body: { query: input.trim(), depth: "thorough" },
    });
    if (error) throw error;
    const output = data?.report ?? data?.summary ?? data?.result ?? data?.output ?? JSON.stringify(data);
    return { skillName: "market-research", output };
  } catch (err) {
    return {
      skillName: "market-research",
      output: `Research failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill({
  name: "market-research",
  description: "Runs a deep multi-source research pass on any topic — market, industry, person, or concept",
  keywords: [
    "research", "deep research", "look into", "find information about",
    "market research", "industry research", "investigate", "what is", "who is",
    "tell me about the market", "research report", "due diligence",
  ],
}, handler);
