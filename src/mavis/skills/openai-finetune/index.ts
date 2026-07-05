// SKILL: openai-finetune
// Starts an OpenAI fine-tune job from conversation data via mavis-openai-finetune.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const model = input?.match(/gpt-4o|gpt-4|gpt-3\.5/i)?.[0] ?? "gpt-4o-mini";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-openai-finetune", {
      body: { base_model: model, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.job_id ?? data?.status ?? data?.output;
    return { skillName: "openai-finetune", output: result ? `🧬 **OpenAI Fine-tune:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "openai-finetune", output: `Fine-tune error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "openai-finetune",
  description: "Starts an OpenAI fine-tune job using MAVIS conversation history as training data",
  keywords: [
    "openai finetune", "fine tune gpt", "start fine tune", "train gpt model",
    "finetune job", "openai training", "fine-tune openai",
  ],
}, handler);
