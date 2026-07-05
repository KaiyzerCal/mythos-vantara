// SKILL: performance-science
// Applies performance science principles to optimize energy, focus, and output via mavis-performance-science.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "performance-science", output: "Get performance science insights. Example: 'performance science: how to optimize my morning' or 'performance protocol for deep work'" };
  }
  const question = input.replace(/^(performance science|performance protocol|optimize performance)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-performance-science", {
      body: { question, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.protocol ?? data?.insights ?? data?.output;
    return { skillName: "performance-science", output: result ? `⚡ **Performance Science:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "performance-science", output: `Performance science error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "performance-science",
  description: "Applies evidence-based performance science to optimize energy, focus, recovery, and output",
  keywords: [
    "performance science", "performance protocol", "optimize performance", "peak performance",
    "energy optimization", "focus protocol", "recovery science", "performance insights",
    "cognitive performance", "productivity science",
  ],
}, handler);
