// SKILL: health-protocol
// Pattern from 500-AI-Agents #16 (health/fitness agent).
// Calls mavis-health-protocol for training, recovery, and performance science.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-health-protocol", {
      body: { userId: ctx.userId, request: input?.trim() || "give me my current protocol" },
    });
    if (error) throw error;
    return { skillName: "health-protocol", output: data?.protocol ?? data?.plan ?? data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "health-protocol", output: `Health protocol failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "health-protocol",
  description: "Generates and reviews training, recovery, nutrition, and performance protocols",
  keywords: [
    "workout", "training protocol", "fitness plan", "exercise", "recovery protocol",
    "training plan", "workout plan", "performance science", "strength training",
    "cardio plan", "recovery", "health protocol", "optimize training",
  ],
}, handler);
