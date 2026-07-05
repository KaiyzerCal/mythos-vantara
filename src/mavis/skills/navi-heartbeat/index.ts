// SKILL: navi-heartbeat
// Checks NAVI agent health and availability via navi-heartbeat.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("navi-heartbeat", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.status ?? data?.health ?? data?.output;
    return { skillName: "navi-heartbeat", output: result ? `💓 **NAVI Heartbeat:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "navi-heartbeat", output: `NAVI heartbeat error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "navi-heartbeat",
  description: "Checks NAVI agent health — availability, latency, model version, and uptime",
  keywords: [
    "navi heartbeat", "navi health", "check navi", "navi status",
    "is navi online", "navi ping", "navi availability",
  ],
}, handler);
