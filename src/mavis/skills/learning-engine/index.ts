// SKILL: learning-engine
// Generates personalized learning plans and resources via mavis-learning-engine.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "learning-engine", output: "Get a learning plan. Example: 'learning plan for machine learning' or 'how do I learn TypeScript in 30 days'" };
  }
  const topic = input.replace(/^(learning plan|learn|learning engine|study plan)\s*(for\s+)?(how do i learn\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-learning-engine", {
      body: { topic, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.plan ?? data?.resources ?? data?.curriculum ?? data?.output;
    return { skillName: "learning-engine", output: result ? `🎓 **Learning Plan:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "learning-engine", output: `Learning engine error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "learning-engine",
  description: "Generates personalized learning plans, curricula, and curated resources for any topic",
  keywords: [
    "learning plan", "study plan", "learning path", "how to learn", "curriculum",
    "learning engine", "learn this skill", "educational plan", "skill roadmap",
  ],
}, handler);
