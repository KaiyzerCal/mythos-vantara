// SKILL: media-analyst
// Analyzes media coverage, press mentions, and sentiment via mavis-media-analyst.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "media-analyst", output: "Analyze media coverage. Example: 'media analysis of Elon Musk last week' or 'press coverage for my brand'" };
  }
  const subject = input.replace(/^(media analysis|media coverage|press coverage|analyze media)\s*(of\s+|for\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-media-analyst", {
      body: { subject, time_range: "7d" },
    });
    if (error) throw error;
    const result = data?.analysis ?? data?.coverage ?? data?.output;
    return { skillName: "media-analyst", output: result ? `📺 **Media Analysis:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "media-analyst", output: `Media analyst error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "media-analyst",
  description: "Analyzes media coverage, press mentions, and brand/topic sentiment across news outlets",
  keywords: [
    "media analysis", "media coverage", "press mentions", "news coverage",
    "brand mentions", "media sentiment", "press analysis", "coverage report",
    "media monitoring", "press monitoring",
  ],
}, handler);
