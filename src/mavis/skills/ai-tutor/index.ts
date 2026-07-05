// SKILL: ai-tutor
// Provides interactive tutoring and Socratic teaching via mavis-khanmigo.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "ai-tutor", output: "Get tutored on anything. Example: 'tutor me on differential equations' or 'explain options trading like I'm a beginner'" };
  }
  const topic = input.replace(/^(ai tutor|tutor me|teach me|explain|tutor)\s*(on\s+|about\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-khanmigo", {
      body: { topic, user_id: ctx.userId, mode: "socratic" },
    });
    if (error) throw error;
    const result = data?.lesson ?? data?.explanation ?? data?.output;
    return { skillName: "ai-tutor", output: result ? `🎓 **AI Tutor:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "ai-tutor", output: `AI tutor error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "ai-tutor",
  description: "Interactive AI tutor using Socratic method — teaches any subject through dialogue",
  keywords: [
    "ai tutor", "tutor me", "teach me", "explain this to me", "learning session",
    "interactive lesson", "socratic tutoring", "study session", "tutor on",
  ],
}, handler);
