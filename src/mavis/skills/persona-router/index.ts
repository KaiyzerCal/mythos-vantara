// SKILL: persona-router
// Routes requests through the persona provider cascade with smart LLM fallback via mavis-persona-router.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "persona-router", output: "Route through persona cascade. Example: 'persona router: answer as my business advisor persona' or 'switch persona: stoic coach'" };
  }
  const query = input.replace(/^(persona router|route persona|switch persona|activate persona)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-persona-router", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.response ?? data?.output;
    return { skillName: "persona-router", output: result ? `🎭 **Persona Response:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "persona-router", output: `Persona router error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "persona-router",
  description: "Routes through the persona provider cascade — responds through any active persona with smart LLM fallback",
  keywords: [
    "persona router", "route persona", "switch persona", "activate persona",
    "persona cascade", "persona response", "respond as persona",
  ],
}, handler);
