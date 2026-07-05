// SKILL: translate
// Translates any text into any language using mavis-translate.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "translate", output: 'Give me text and a target language. Example: "translate \'hello world\' to Spanish"' };
  }
  const langMatch = input.match(/\bto\s+([A-Za-z]+)\b/i);
  const targetLanguage = langMatch?.[1] ?? "Spanish";
  const text = input.replace(/translate\s+/i, "").replace(/\bto\s+\w+\b/i, "").replace(/^['"]/,"").replace(/['"]$/,"").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-translate", {
      body: { text, target_language: targetLanguage },
    });
    if (error) throw error;
    const translated = data?.translated ?? data?.translation ?? data?.output;
    return { skillName: "translate", output: translated ? `**${targetLanguage}:** ${translated}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "translate", output: `Translation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "translate",
  description: "Translates text into any language instantly",
  keywords: [
    "translate", "translate this", "translate to", "in spanish", "in french",
    "in japanese", "in arabic", "in portuguese", "in german", "in chinese",
    "how do you say", "what is this in", "convert to language",
  ],
}, handler);
