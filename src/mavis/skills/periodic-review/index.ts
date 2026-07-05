// SKILL: periodic-review
// Runs structured periodic reviews (monthly, quarterly, annual) via mavis-periodic-review.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "periodic-review", output: "Run a periodic review. Example: 'monthly review' or 'quarterly business review' or 'annual review'" };
  }
  const period = /annual|yearly/i.test(input) ? "annual"
    : /quarter|q1|q2|q3|q4/i.test(input) ? "quarterly"
    : /month/i.test(input) ? "monthly"
    : /week/i.test(input) ? "weekly"
    : "monthly";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-periodic-review", {
      body: { period, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.review ?? data?.report ?? data?.output;
    return { skillName: "periodic-review", output: result ? `📊 **${period.charAt(0).toUpperCase() + period.slice(1)} Review:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "periodic-review", output: `Periodic review error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "periodic-review",
  description: "Runs structured periodic reviews — weekly, monthly, quarterly, or annual",
  keywords: [
    "periodic review", "monthly review", "quarterly review", "annual review",
    "yearly review", "review my progress", "performance review", "business review",
  ],
}, handler);
