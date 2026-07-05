// SKILL: world-model
// Synthesizes all operator data into a scored world state via mavis-world-model.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-world-model", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.world_state ?? data?.domains ?? data?.output;
    return { skillName: "world-model", output: result ? `🌐 **World Model:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "world-model", output: `World model error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "world-model",
  description: "Synthesizes all life domains into a scored world state — surfaces top opportunity and risk with trajectory",
  keywords: [
    "world model", "life dashboard", "domain scores", "life overview",
    "how am i doing", "overall status", "life score", "world state",
    "show my world", "life audit", "holistic review",
  ],
}, handler);
