// SKILL: health-monitor
// Monitors health metrics and provides trend analysis via mavis-health-monitor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "health-monitor", output: "Monitor your health. Example: 'health monitor this week' or 'health trends for last 30 days'" };
  }
  const period = /30 day|month/i.test(input) ? "30d" : /week/i.test(input) ? "7d" : /today|day/i.test(input) ? "1d" : "7d";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-health-monitor", {
      body: { period, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.report ?? data?.trends ?? data?.metrics ?? data?.output;
    return { skillName: "health-monitor", output: result ? `❤️ **Health Monitor:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "health-monitor", output: `Health monitor error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "health-monitor",
  description: "Monitors health metrics over time, surfacing trends and anomalies",
  keywords: [
    "health monitor", "health trends", "health report", "monitor health",
    "health check", "health dashboard", "health tracking", "wellness monitor",
  ],
}, handler);
