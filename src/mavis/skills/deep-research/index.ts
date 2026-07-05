// SKILL: deep-research
// Multi-source deep research with synthesis via mavis-deep-research.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "deep-research", output: "Give me a topic and I'll do a comprehensive multi-source research dive. Example: 'deep research on AI chip shortage 2025'" };
  }
  const query = input.replace(/^(deep research on|research deeply|comprehensive research on|thoroughly research)\s+/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-deep-research", {
      body: { query, depth: "deep" },
    });
    if (error) throw error;
    const result = data?.synthesis ?? data?.report ?? data?.result ?? data?.output;
    return { skillName: "deep-research", output: result ? `🔬 **Deep Research: ${query}**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "deep-research", output: `Deep research failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "deep-research",
  description: "Runs a multi-source deep research dive and synthesizes a comprehensive report",
  keywords: [
    "deep research", "research deeply", "comprehensive research", "thoroughly research",
    "deep dive into", "full analysis of", "investigate deeply", "multi-source research",
    "exhaustive research", "full research report", "research everything about",
  ],
}, handler);
