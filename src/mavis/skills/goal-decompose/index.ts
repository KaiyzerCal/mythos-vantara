// SKILL: goal-decompose
// Decomposes a high-level goal into concrete quests via mavis-goal-engine.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "goal-decompose", output: "Decompose a goal into quests. Example: 'decompose goal: build a $10k MRR SaaS by end of year'" };
  }
  const goal = input.replace(/^(decompose goal|break down goal|goal decompose|goal breakdown)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-goal-engine", {
      body: { goal, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.quests ?? data?.breakdown ?? data?.output;
    return { skillName: "goal-decompose", output: result ? `🎯 **Goal Breakdown:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "goal-decompose", output: `Goal decompose error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "goal-decompose",
  description: "Decomposes a high-level goal into 3–5 concrete actionable quests stored in Vantara",
  keywords: [
    "decompose goal", "break down goal", "goal breakdown", "goal into steps",
    "goal decompose", "convert goal to quests", "goal to tasks", "goal planning",
  ],
}, handler);
