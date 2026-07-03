// SKILL: weekly-retro
// Calls mavis-weekly-retro for a structured week-in-review covering wins,
// misses, energy, goals, habits, and priorities for next week.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-weekly-retro", {
      body: { userId: ctx.userId },
    });
    if (error) throw error;
    return { skillName: "weekly-retro", output: data?.retro ?? data?.review ?? data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "weekly-retro", output: `Weekly retro failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "weekly-retro",
  description: "Runs a structured week-in-review: wins, misses, energy trends, goal progress, and next week priorities",
  keywords: [
    "weekly review", "week recap", "weekly retro", "end of week", "week in review",
    "how was my week", "week summary", "what did i accomplish this week",
    "weekly check-in", "weekly debrief", "what happened this week",
  ],
}, handler);
