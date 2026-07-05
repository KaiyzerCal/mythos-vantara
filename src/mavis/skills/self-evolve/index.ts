// SKILL: self-evolve
// Uses Claude Opus with extended thinking to rewrite MAVIS's own tacit rules via mavis-self-evolve.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-self-evolve", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.evolution ?? data?.changes ?? data?.output;
    return { skillName: "self-evolve", output: result ? `🧬 **Self-Evolution:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "self-evolve", output: `Self-evolve error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "self-evolve",
  description: "Claude Opus with extended thinking rewrites MAVIS's own tacit rules based on outcome accuracy and behavioral patterns",
  keywords: [
    "self evolve", "evolve mavis", "upgrade mavis", "mavis self improvement",
    "rewrite rules", "system evolution", "mavis upgrade", "self evolution",
  ],
}, handler);
