// SKILL: comic-gen
// Generates comic strips and illustrated stories via mavis-comic-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "comic-gen", output: "Tell me the story or idea and I'll make a comic strip. Example: 'comic strip about a robot learning to cook'" };
  }
  const story = input.replace(/^(create|make|generate|draw)\s+(a\s+)?(comic|comic strip|illustrated story)\s+(about|of|showing)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-comic-agent", {
      body: { prompt: story, panels: 4, style: "modern-clean" },
    });
    if (error) throw error;
    const panels = data?.panels ?? data?.images ?? [];
    if (Array.isArray(panels) && panels.length > 0) {
      const imgs = panels.map((p: any, i: number) => `**Panel ${i + 1}:** ${p.caption ?? ""}\n![panel-${i + 1}](${p.url ?? p.image_url ?? ""})`).join("\n\n");
      return { skillName: "comic-gen", output: `🎨 **Comic: ${story.slice(0, 60)}**\n\n${imgs}` };
    }
    const url = data?.url ?? data?.output;
    return { skillName: "comic-gen", output: url ? `🎨 **Comic:**\n\n![comic](${url})` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "comic-gen", output: `Comic generation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "comic-gen",
  description: "Generates comic strips and illustrated visual stories from text prompts",
  keywords: [
    "comic strip", "create a comic", "make a comic", "comic book",
    "draw a comic", "illustrated story", "comic about", "manga",
    "graphic novel panel", "visual story", "cartoon strip",
  ],
}, handler);
