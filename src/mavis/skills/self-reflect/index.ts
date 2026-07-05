// SKILL: self-reflect
// Deep introspective reflection and journaling prompts via mavis-self-reflect.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "self-reflect", output: "What do you want to reflect on? I'll guide you through a deep introspection. Example: 'reflect on why I keep procrastinating' or 'help me journal about my goals'" };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-self-reflect", {
      body: { prompt: input.trim(), user_id: ctx.userId, depth: "deep" },
    });
    if (error) throw error;
    const result = data?.reflection ?? data?.insight ?? data?.response ?? data?.output;
    return { skillName: "self-reflect", output: result ? `🪞 **Reflection:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "self-reflect", output: `Reflection error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "self-reflect",
  description: "Guides deep introspection, journaling, and self-awareness exercises",
  keywords: [
    "reflect on", "help me reflect", "introspect", "journal about",
    "think through", "examine why", "self reflection", "deeper look at",
    "unpack this", "process this feeling", "what does this mean",
  ],
}, handler);
