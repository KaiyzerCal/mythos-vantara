// SKILL: video-render
// Renders and exports final video files via fal.ai + Gemini pipeline (mavis-video-render).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "video-render", output: "Render a video. Example: 'video render: [url] as 9:16 for TikTok' or 'render this video with subtitles'" };
  }
  const instructions = input.replace(/^(video render|render video|render)\s*:?\s*/i, "").trim() || input;
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-video-render", {
      body: { instructions, video_url: url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.video_url ?? data?.job_id ?? data?.output;
    return { skillName: "video-render", output: result ? `🎞️ **Video Rendered:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "video-render", output: `Video render error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "video-render",
  description: "Renders and exports video files via fal.ai + Gemini — format conversion, aspect ratio, export",
  keywords: [
    "video render", "render video", "export video", "video export",
    "render to tiktok", "render for instagram", "video format", "video pipeline",
  ],
}, handler);
