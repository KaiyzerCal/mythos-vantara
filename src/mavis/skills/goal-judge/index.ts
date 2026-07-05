// SKILL: goal-judge
// Evaluates goal quality, alignment, and feasibility via mavis-goal-judge.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "goal-judge", output: "Judge a goal. Example: 'goal judge: hit $1M ARR by December' or 'evaluate my goal to launch 3 products this year'" };
  }
  const goal = input.replace(/^(goal judge|judge goal|evaluate goal|assess goal)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-goal-judge", {
      body: { goal, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.judgment ?? data?.evaluation ?? data?.score ?? data?.output;
    return { skillName: "goal-judge", output: result ? `⚖️ **Goal Judgment:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "goal-judge", output: `Goal judge error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "goal-judge",
  description: "Evaluates goal quality, SMART criteria, feasibility, and alignment with your mission",
  keywords: [
    "goal judge", "judge goal", "evaluate goal", "assess goal", "is my goal good",
    "goal quality", "goal feedback", "critique goal", "goal evaluation",
  ],
}, handler);
