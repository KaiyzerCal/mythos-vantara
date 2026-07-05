// SKILL: navi-finetune
// Triggers NAVI fine-tune pipeline from curated conversation data via navi-finetune-pipeline.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("navi-finetune-pipeline", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.job_id ?? data?.pipeline ?? data?.output;
    return { skillName: "navi-finetune", output: result ? `🧬 **NAVI Fine-tune Pipeline:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "navi-finetune", output: `NAVI finetune error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "navi-finetune",
  description: "Triggers the NAVI fine-tune pipeline — curates data, uploads to OpenAI, starts training",
  keywords: [
    "navi finetune", "train navi", "navi fine tune", "finetune navi",
    "start navi training", "navi training pipeline", "retrain navi",
  ],
}, handler);
