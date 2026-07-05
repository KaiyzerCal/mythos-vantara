// SKILL: receptionist-config
// Configures MAVIS AI receptionist — voice, greeting, routing rules via mavis-receptionist-config.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "receptionist-config", output: "Configure AI receptionist. Example: 'configure receptionist: greeting: Hello, I am Calvin's assistant' or 'set receptionist voice to female'" };
  }
  const config = input.replace(/^(configure receptionist|receptionist config|set receptionist)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-receptionist-config", {
      body: { config, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.receptionist ?? data?.config ?? data?.output;
    return { skillName: "receptionist-config", output: result ? `📞 **Receptionist Config:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "receptionist-config", output: `Receptionist config error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "receptionist-config",
  description: "Configures the MAVIS AI receptionist — greeting, voice, call routing, and availability",
  keywords: [
    "receptionist config", "configure receptionist", "ai receptionist setup",
    "set receptionist", "receptionist voice", "call routing config",
  ],
}, handler);
