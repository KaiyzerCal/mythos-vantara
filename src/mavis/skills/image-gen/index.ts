// SKILL: image-gen
// Calls mavis-image-gen to generate images from natural language descriptions.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "image-gen", output: "Describe the image you want and I'll generate it." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-image-gen", {
      body: { prompt: input.trim() },
    });
    if (error) throw error;
    const url = data?.url ?? data?.image_url ?? data?.output;
    if (url) return { skillName: "image-gen", output: `Image generated: ${url}`, data: { url } };
    return { skillName: "image-gen", output: data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "image-gen", output: `Image generation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "image-gen",
  description: "Generates images from text descriptions using AI image generation",
  keywords: [
    "generate image", "create image", "make an image", "visualize", "draw",
    "generate a picture", "create a visual", "image of", "picture of",
    "render", "generate art", "create artwork", "design image",
  ],
}, handler);
