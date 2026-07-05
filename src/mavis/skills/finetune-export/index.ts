// SKILL: finetune-export
// Exports fine-tune training data from MAVIS conversations via mavis-fine-tune-export.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const format = /jsonl|json|csv/i.exec(input ?? "")?.[0]?.toLowerCase() ?? "jsonl";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-fine-tune-export", {
      body: { format, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.export ?? data?.file ?? data?.output;
    return { skillName: "finetune-export", output: result ? `📤 **Fine-tune Export:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "finetune-export", output: `Fine-tune export error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "finetune-export",
  description: "Exports MAVIS conversation history as JSONL fine-tune training data",
  keywords: [
    "finetune export", "export training data", "export conversations", "training export",
    "export fine tune data", "conversation export", "export for training",
  ],
}, handler);
