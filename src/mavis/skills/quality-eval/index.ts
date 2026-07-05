// SKILL: quality-eval
// Scores AI-generated content 0–10 on configurable criteria via mavis-quality-eval.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "quality-eval", output: "Score content quality. Example: 'quality eval: [paste your content here]' or 'score this: [text]'" };
  }
  const content = input.replace(/^(quality eval|score this|evaluate quality|quality score)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-quality-eval", {
      body: { content, criteria: ["accuracy", "completeness", "actionability", "clarity", "no_hallucination"] },
    });
    if (error) throw error;
    const result = data?.scores ?? data?.evaluation ?? data?.output;
    return { skillName: "quality-eval", output: result ? `📊 **Quality Evaluation:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "quality-eval", output: `Quality eval error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "quality-eval",
  description: "Scores AI output or any content 0–10 across accuracy, completeness, actionability, clarity, and hallucination",
  keywords: [
    "quality eval", "score content", "quality score", "evaluate quality",
    "content score", "rate this content", "quality check ai",
  ],
}, handler);
