// SKILL: higgsfield-video
// Generates cinematic AI video with Higgsfield — image-to-video, camera motion via mavis-higgsfield.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "higgsfield-video", output: "Create cinematic AI video. Example: 'higgsfield: cinematic pan of a futuristic city at night' or 'higgsfield video: [image url] with slow zoom'" };
  }
  const prompt = input.replace(/^(higgsfield|higgsfield video|cinematic video)\s*:?\s*/i, "").trim() || input;
  const imageUrl = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-higgsfield", {
      body: { prompt, image_url: imageUrl, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.video_url ?? data?.job_id ?? data?.output;
    return { skillName: "higgsfield-video", output: result ? `🎬 **Higgsfield Video:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "higgsfield-video", output: `Higgsfield error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "higgsfield-video",
  description: "Cinematic AI video generation via Higgsfield — image-to-video, camera motion, character-consistent short-form",
  keywords: [
    "higgsfield", "higgsfield video", "cinematic ai video", "image to video cinematic",
    "higgsfield animation", "camera motion video", "cinematic video gen",
  ],
}, handler);
