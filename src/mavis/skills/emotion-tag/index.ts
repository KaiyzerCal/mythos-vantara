// SKILL: emotion-tag
// Auto-tags content with emotional labels for mood tracking via mavis-emotion-tag.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "emotion-tag", output: "Tag content with emotions. Example: 'emotion tag: today was exhausting but rewarding' or 'tag this journal entry with emotions'" };
  }
  const text = input.replace(/^(emotion tag|tag emotions|mood tag|tag with emotions)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-emotion-tag", {
      body: { text },
    });
    if (error) throw error;
    const result = data?.tags ?? data?.emotions ?? data?.labels ?? data?.output;
    return { skillName: "emotion-tag", output: result ? `🏷️ **Emotion Tags:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "emotion-tag", output: `Emotion tag error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "emotion-tag",
  description: "Auto-tags text and journal entries with emotional labels for mood tracking",
  keywords: [
    "emotion tag", "mood tag", "tag emotions", "emotional labels", "tag feelings",
    "mood label", "emotion labels", "tag with mood",
  ],
}, handler);
