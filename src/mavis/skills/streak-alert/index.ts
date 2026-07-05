// SKILL: streak-alert
// Fires daily habit streak protection alerts — finds habits not yet done today via mavis-streak-alerts.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-streak-alerts", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.alerts ?? data?.habits_at_risk ?? data?.output;
    return { skillName: "streak-alert", output: result ? `🔥 **Streak Alerts:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "streak-alert", output: `Streak alert error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "streak-alert",
  description: "Checks which habit streaks are at risk today — habits with active streaks not yet completed",
  keywords: [
    "streak alert", "streak protection", "habits at risk", "check streaks",
    "streak check", "protect streak", "streak status",
  ],
}, handler);
