// SKILL: emotion-analysis
// Analyzes emotional tone, sentiment, and affect in text or behavior via mavis-emotion-engine.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "emotion-analysis", output: "Analyze emotion in text. Example: 'emotion analysis: I'm feeling overwhelmed and uncertain about the launch' or 'analyze sentiment of my email'" };
  }
  const text = input.replace(/^(emotion analysis|analyze emotion|sentiment analysis|analyze sentiment|emotion engine)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-emotion-engine", {
      body: { text },
    });
    if (error) throw error;
    const result = data?.emotions ?? data?.sentiment ?? data?.analysis ?? data?.output;
    return { skillName: "emotion-analysis", output: result ? `💭 **Emotion Analysis:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "emotion-analysis", output: `Emotion analysis error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "emotion-analysis",
  description: "Analyzes emotional tone, sentiment, and psychological state in text or writing",
  keywords: [
    "emotion analysis", "sentiment analysis", "analyze emotion", "emotional tone",
    "how does this sound emotionally", "detect sentiment", "emotion engine",
    "emotional intelligence", "affect analysis",
  ],
}, handler);
