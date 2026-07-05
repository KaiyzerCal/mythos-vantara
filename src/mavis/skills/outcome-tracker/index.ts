// SKILL: outcome-tracker
// Tracks outcomes, results, and progress toward goals via mavis-outcome-tracker.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "outcome-tracker", output: "Track an outcome. Example: 'outcome: closed 3 deals this week' or 'track result: launched feature X'" };
  }
  const outcome = input.replace(/^(outcome|track outcome|track result|log outcome)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-outcome-tracker", {
      body: { outcome, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.tracked ?? data?.status ?? data?.output;
    return { skillName: "outcome-tracker", output: result ? `🎯 **Outcome Tracked:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "outcome-tracker", output: `Outcome tracker error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "outcome-tracker",
  description: "Logs and tracks outcomes, results, and progress toward goals over time",
  keywords: [
    "outcome tracker", "track outcome", "log result", "track result",
    "record outcome", "outcome log", "results tracker", "progress log",
  ],
}, handler);
