// SKILL: avatar-video
// Generates AI talking-head avatar videos from a script via mavis-avatar-video.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "avatar-video", output: "Create an avatar video. Example: 'avatar video: Welcome to my channel, today we discuss AI trends...' or 'talking head: [script]'" };
  }
  const script = input.replace(/^(avatar video|talking head|create avatar|avatar)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-avatar-video", {
      body: { script, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.video_url ?? data?.job_id ?? data?.output;
    return { skillName: "avatar-video", output: result ? `🎥 **Avatar Video:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "avatar-video", output: `Avatar video error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "avatar-video",
  description: "Generates AI talking-head avatar videos from a script — lip-synced, photorealistic",
  keywords: [
    "avatar video", "talking head", "create avatar", "ai avatar", "lip sync video",
    "face video", "avatar script", "talking avatar", "ai presenter",
  ],
}, handler);
