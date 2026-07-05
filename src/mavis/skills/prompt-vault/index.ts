// SKILL: prompt-vault
// Saves, retrieves, and manages reusable prompts via mavis-prompt-vault.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "prompt-vault", output: "Save or retrieve prompts. Example: 'save prompt: cold email template [prompt text]' or 'get my email prompts'" };
  }
  const isSave = /save prompt|store prompt|add prompt/i.test(input);
  const content = input.replace(/^(save prompt|store prompt|add prompt|get prompt|prompt vault|retrieve prompt)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-prompt-vault", {
      body: { action: isSave ? "save" : "search", content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.prompts ?? data?.saved ?? data?.output;
    return { skillName: "prompt-vault", output: result ? `🗄️ **Prompt Vault:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "prompt-vault", output: `Prompt vault error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "prompt-vault",
  description: "Saves, organizes, and retrieves your best reusable prompts and templates",
  keywords: [
    "prompt vault", "save prompt", "store prompt", "my prompts", "get prompt",
    "prompt library", "retrieve prompt", "prompt templates", "saved prompts",
  ],
}, handler);
