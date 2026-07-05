// SKILL: whoop-stats
// Fetches WHOOP recovery, strain, and sleep data via mavis-whoop-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const action = input && /strain|workout/i.test(input) ? "strain"
    : input && /sleep/i.test(input) ? "sleep"
    : "recovery";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-whoop-sync", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.recovery ?? data?.strain ?? data?.sleep ?? data?.summary ?? data?.output;
    return {
      skillName: "whoop-stats",
      output: result
        ? `💚 **WHOOP ${action.charAt(0).toUpperCase() + action.slice(1)}:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}`
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "whoop-stats", output: `WHOOP error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "whoop-stats",
  description: "Fetches your WHOOP recovery score, strain, and sleep performance data",
  keywords: [
    "whoop", "my whoop", "recovery score", "whoop recovery", "whoop strain",
    "whoop sleep", "hrv today", "readiness score whoop",
    "whoop data", "my recovery", "body battery",
  ],
}, handler);
