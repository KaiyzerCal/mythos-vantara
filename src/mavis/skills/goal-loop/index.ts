// SKILL: goal-loop
// Runs a Manus-style autonomous think→plan→act loop until a goal is achieved via mavis-goal-loop.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "goal-loop", output: "Run an autonomous goal loop. Example: 'goal loop: research and summarize top 5 AI tools for content creators'" };
  }
  const goal = input.replace(/^(goal loop|autonomous loop|run goal loop|agentic loop)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-goal-loop", {
      body: { goal, user_id: ctx.userId, max_iterations: 10 },
    });
    if (error) throw error;
    const result = data?.result ?? data?.trace ?? data?.output;
    return { skillName: "goal-loop", output: result ? `🔄 **Goal Loop Complete:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "goal-loop", output: `Goal loop error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "goal-loop",
  description: "Autonomous think→plan→act loop that works until a goal is fully achieved",
  keywords: [
    "goal loop", "autonomous loop", "agentic loop", "run until done",
    "autonomous goal", "keep working on", "loop until complete", "run goal",
  ],
}, handler);
