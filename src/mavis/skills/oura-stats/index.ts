// SKILL: oura-stats
// Fetches Oura Ring readiness, sleep, and activity data via mavis-oura-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const action = input && /sleep/i.test(input) ? "sleep"
    : input && /activity|steps/i.test(input) ? "activity"
    : "readiness";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-oura-sync", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.readiness ?? data?.sleep ?? data?.activity ?? data?.summary ?? data?.output;
    return {
      skillName: "oura-stats",
      output: result
        ? `💍 **Oura Ring ${action.charAt(0).toUpperCase() + action.slice(1)}:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}`
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "oura-stats", output: `Oura error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "oura-stats",
  description: "Reads Oura Ring readiness, sleep quality, and daily activity scores",
  keywords: [
    "oura", "oura ring", "readiness score", "oura sleep", "oura activity",
    "oura data", "sleep score oura", "oura ring data", "my readiness",
    "hrv oura", "deep sleep oura",
  ],
}, handler);
