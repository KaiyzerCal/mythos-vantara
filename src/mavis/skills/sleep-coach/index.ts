// SKILL: sleep-coach
// Personalized sleep coaching and bedtime routine recommendations via mavis-sleep-coach.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "sleep-coach", output: "I can help improve your sleep. Try: 'help me sleep better', 'build me a sleep routine', or 'why am I tired in the morning?'" };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-sleep-coach", {
      body: { message: input.trim(), user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.advice ?? data?.response ?? data?.output;
    return { skillName: "sleep-coach", output: result ? `😴 **Sleep Coach:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "sleep-coach", output: `Sleep coach error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "sleep-coach",
  description: "Provides personalized sleep coaching, routines, and recovery advice",
  keywords: [
    "sleep better", "sleep routine", "bedtime routine", "insomnia", "can't sleep",
    "improve sleep", "sleep schedule", "sleep hygiene", "tired in the morning",
    "sleep quality", "wake up tired", "deep sleep", "sleep tips",
  ],
}, handler);
