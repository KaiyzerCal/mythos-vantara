// SKILL: persona-forge
// Generates complete AI persona specs (name, voice, backstory, traits) from a description via mavis-persona-forge.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "persona-forge", output: "Forge a new AI persona. Example: 'persona forge: a stoic venture capitalist advisor named Marcus' or 'create persona: friendly health coach'" };
  }
  const description = input.replace(/^(persona forge|forge persona|create persona|new persona|design persona)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-persona-forge", {
      body: { description, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.persona ?? data?.spec ?? data?.output;
    return { skillName: "persona-forge", output: result ? `🎭 **Persona Forged:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "persona-forge", output: `Persona forge error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "persona-forge",
  description: "Generates a complete AI persona JSON spec — name, voice, backstory, traits, communication style",
  keywords: [
    "persona forge", "forge persona", "create persona", "new persona", "design persona",
    "build persona", "ai persona", "persona architect", "custom persona",
  ],
}, handler);
