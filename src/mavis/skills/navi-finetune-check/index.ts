// SKILL: navi-finetune-check
// Checks the status of NAVI fine-tune jobs via navi-finetune-check.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("navi-finetune-check", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.jobs ?? data?.status ?? data?.output;
    return { skillName: "navi-finetune-check", output: result ? `🔎 **NAVI Fine-tune Status:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "navi-finetune-check", output: `NAVI finetune check error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "navi-finetune-check",
  description: "Checks the status of NAVI fine-tune jobs — training progress, completion, model ID",
  keywords: [
    "navi finetune check", "check navi training", "navi fine tune status",
    "finetune status navi", "navi training status", "check navi finetune",
  ],
}, handler);
