// SKILL: video-download
// Downloads videos from YouTube, Twitter, and other platforms via mavis-video-download.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "video-download", output: "Download a video. Example: 'download video https://youtube.com/watch?v=...' or 'save this video'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0];
  if (!url) return { skillName: "video-download", output: "Please provide a video URL to download." };
  const quality = /4k|2160/i.test(input) ? "2160p" : /1080|hd/i.test(input) ? "1080p" : /720/i.test(input) ? "720p" : "best";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-video-download", {
      body: { url, quality, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.download_url ?? data?.file ?? data?.output;
    return { skillName: "video-download", output: result ? `⬇️ **Video Download:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "video-download", output: `Video download error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "video-download",
  description: "Downloads videos from YouTube, Twitter/X, Instagram, and other platforms",
  keywords: [
    "download video", "video download", "save video", "download youtube",
    "download twitter video", "download instagram video", "save youtube video",
  ],
}, handler);
