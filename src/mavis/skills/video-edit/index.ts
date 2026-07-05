// SKILL: video-edit
// Edits videos with AI — trim, caption, clip, enhance via mavis-video-editor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "video-edit", output: "Edit a video with AI. Example: 'video edit: add captions to my video at [url]' or 'clip the best 60 seconds from [video]'" };
  }
  const instructions = input.replace(/^(video edit|edit video|video editor)\s*:?\s*/i, "").trim() || input;
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-video-editor", {
      body: { instructions, video_url: url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.video_url ?? data?.result ?? data?.output;
    return { skillName: "video-edit", output: result ? `🎬 **Video Edit:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "video-edit", output: `Video edit error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "video-edit",
  description: "AI-powered video editing — trim, caption, clip highlights, add effects",
  keywords: [
    "video edit", "edit video", "add captions", "video clip", "trim video",
    "video editor", "cut video", "highlight clip", "video editing",
  ],
}, handler);
