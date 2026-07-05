// SKILL: cron-setup
// Creates and manages scheduled automations and cron jobs via mavis-cron-setup.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "cron-setup", output: "Schedule an automation. Example: 'cron: send me a daily brief at 8am' or 'schedule: run competitor check every Monday'" };
  }
  const schedule = input.replace(/^(cron|cron setup|schedule|schedule automation)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-cron-setup", {
      body: { schedule_description: schedule, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.cron ?? data?.job ?? data?.status ?? data?.output;
    return { skillName: "cron-setup", output: result ? `⏰ **Cron Scheduled:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "cron-setup", output: `Cron setup error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "cron-setup",
  description: "Creates scheduled automations and recurring tasks on a cron schedule",
  keywords: [
    "cron", "schedule automation", "recurring task", "daily automation",
    "weekly task", "schedule job", "cron job", "automate daily", "set schedule",
  ],
}, handler);
