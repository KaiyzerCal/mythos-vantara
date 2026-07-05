// SKILL: wearable-data
// Overlays and analyzes wearable device data (HRV, sleep, readiness) via mavis-wearable-overlay.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "wearable-data", output: "Analyze wearable data. Example: 'wearable data today' or 'overlay my HRV sleep and readiness scores'" };
  }
  const metrics = input.replace(/^(wearable data|wearable overlay|biometric data|wearable)\s*/i, "").trim() || "all";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-wearable-overlay", {
      body: { metrics, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.overlay ?? data?.metrics ?? data?.output;
    return { skillName: "wearable-data", output: result ? `⌚ **Wearable Data:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "wearable-data", output: `Wearable data error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "wearable-data",
  description: "Overlays and analyzes data from wearables — HRV, sleep stages, readiness, and activity",
  keywords: [
    "wearable data", "biometric data", "hrv", "readiness score", "wearable overlay",
    "health metrics", "fitness data", "wearable stats", "body data",
  ],
}, handler);
