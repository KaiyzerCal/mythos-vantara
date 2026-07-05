// SKILL: story-gen
// Generates AI stories with TTS narration and illustration, posts to Telegram via mavis-story-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "story-gen", output: "Generate a story. Example: 'story: a young inventor discovers a portal in their garage' or 'write a children's story about a brave rabbit'" };
  }
  const prompt = input.replace(/^(story gen|generate story|write story|story|create story|children's story)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-story-agent", {
      body: { prompt, user_id: ctx.userId, include_narration: true, include_illustration: true },
    });
    if (error) throw error;
    const result = data?.story ?? data?.text ?? data?.output;
    return { skillName: "story-gen", output: result ? `📖 **Story:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "story-gen", output: `Story gen error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "story-gen",
  description: "Generates AI stories with TTS narration and AI illustration — full storytelling pipeline",
  keywords: [
    "story gen", "generate story", "write story", "create story", "storytelling",
    "children's story", "short story", "narrative story", "story generation",
  ],
}, handler);
