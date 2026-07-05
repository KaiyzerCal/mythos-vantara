// SKILL: compound-learn
// Records learning signals and consolidates them into lasting operator knowledge via mavis-compound-learning.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "compound-learn", output: "Record a learning. Example: 'compound learn: cold emails with personalized first lines get 3x more replies' or 'learning: always ship MVP before building features'" };
  }
  const learning = input.replace(/^(compound learn|learning|record learning|add learning|learn)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-compound-learning", {
      body: { learning, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.status ?? data?.consolidated ?? data?.output;
    return { skillName: "compound-learn", output: result ? `📚 **Compound Learning:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "compound-learn", output: `Compound learn error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "compound-learn",
  description: "Records learning signals that compound over time — weekly consolidated into lasting operator updates",
  keywords: [
    "compound learn", "record learning", "add learning", "learning signal",
    "i learned that", "note this learning", "compound knowledge",
  ],
}, handler);
