// SKILL: persona-social
// Multi-persona social media — generate/schedule/post in any persona's voice via mavis-persona-social.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "persona-social", output: "Post as a persona. Example: 'persona social [nora]: post about AI trends' or 'post as [persona name]: [content]'" };
  }
  const personaMatch = input.match(/\[([^\]]+)\]/);
  const persona = personaMatch?.[1] ?? null;
  const content = input.replace(/\[[^\]]+\]/, "").replace(/^(persona social|post as|social as)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-persona-social", {
      body: { persona, content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.post ?? data?.scheduled ?? data?.output;
    return { skillName: "persona-social", output: result ? `🎭 **Persona Social:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "persona-social", output: `Persona social error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "persona-social",
  description: "Multi-persona social media agent — generates and posts content in any persona's voice",
  keywords: [
    "persona social", "post as persona", "social as persona", "persona post",
    "post in persona", "persona content", "agent social post",
  ],
}, handler);
