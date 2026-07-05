// SKILL: podcast-gen
// Creates AI-generated podcast episodes from notes or topics via mavis-notebook-podcast.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "podcast-gen", output: "Give me a topic or notes and I'll turn them into a podcast episode. Example: 'create a podcast episode about the future of AI'" };
  }
  const topic = input.replace(/^(create|generate|make|produce)\s+(a\s+)?(podcast|episode|podcast episode)\s+(about|on|covering)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-notebook-podcast", {
      body: { topic, format: "monologue", duration_minutes: 5 },
    });
    if (error) throw error;
    const result = data?.script ?? data?.audio_url ?? data?.output;
    return {
      skillName: "podcast-gen",
      output: result
        ? `🎙️ **Podcast Episode: "${topic}"**\n\n${typeof result === "string" && result.startsWith("http") ? `[Listen](${result})` : result}`
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "podcast-gen", output: `Podcast generation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "podcast-gen",
  description: "Creates AI-generated podcast episodes from topics or notes",
  keywords: [
    "podcast", "create a podcast", "generate podcast", "podcast episode",
    "make a podcast", "podcast script", "turn into podcast", "audio episode",
    "podcast about", "interview podcast", "podcast content",
  ],
}, handler);
