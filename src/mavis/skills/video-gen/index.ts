// SKILL: video-gen
// AI video generation from text prompts via mavis-video-gen.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "video-gen", output: "Describe the video you want and I'll generate it. Example: 'generate a video of a sunset over the ocean' or 'create a product demo video'" };
  }
  const prompt = input.replace(/^(generate|create|make|render)\s+(a\s+)?(video|clip|animation)\s+(of|about|showing|depicting)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-video-gen", {
      body: { prompt, aspect_ratio: "16:9" },
    });
    if (error) throw error;
    const url = data?.url ?? data?.video_url ?? data?.output;
    return {
      skillName: "video-gen",
      output: url
        ? `🎬 Video generated!\n\n[Watch Video](${url})\n\n_Prompt: "${prompt.slice(0, 100)}"_`
        : (data?.status === "processing" ? `⏳ Video is being generated. Check back shortly.\n${JSON.stringify(data)}` : JSON.stringify(data)),
    };
  } catch (err) {
    return { skillName: "video-gen", output: `Video generation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "video-gen",
  description: "Generates AI videos from text descriptions",
  keywords: [
    "generate a video", "create a video", "make a video", "ai video",
    "video of", "video about", "render a video", "produce a video",
    "video clip", "animated video", "video generation",
  ],
}, handler);
