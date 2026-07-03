// SKILL: goal-review
// Calls mavis-goal-review to run a structured review of all active goals,
// progress toward them, blockers, and recommended next actions.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-goal-review", {
      body: { userId: ctx.userId, focus: input?.trim() || "all" },
    });
    if (error) throw error;
    return { skillName: "goal-review", output: data?.review ?? data?.report ?? data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "goal-review", output: `Goal review failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "goal-review",
  description: "Reviews all active goals and quests — progress, blockers, momentum, and next priority actions",
  keywords: [
    "goal review", "review my goals", "goal check", "how am i doing on my goals",
    "goal progress", "quest progress", "am i on track", "goal update",
    "what goals", "goals this week", "goal status", "review quests",
  ],
}, handler);
