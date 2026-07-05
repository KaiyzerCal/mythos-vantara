// SKILL: repurpose-content
// Repurposes content across formats — blog to threads, video to newsletter via mavis-repurpose.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "repurpose-content", output: "Repurpose content. Example: 'repurpose this blog post to 5 tweets' or 'turn my youtube video into a newsletter'" };
  }
  const target = /tweet|twitter|thread/i.test(input) ? "twitter_thread"
    : /newsletter|email/i.test(input) ? "newsletter"
    : /linkedin/i.test(input) ? "linkedin_post"
    : /tiktok|reel|short/i.test(input) ? "short_video_script"
    : /instagram/i.test(input) ? "instagram_caption"
    : "multiple_formats";
  const content = input.replace(/^(repurpose|repurpose content|repurpose this)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-repurpose", {
      body: { content, target_format: target, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.repurposed ?? data?.formats ?? data?.output;
    return { skillName: "repurpose-content", output: result ? `♻️ **Repurposed Content:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "repurpose-content", output: `Repurpose error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "repurpose-content",
  description: "Repurposes content across formats — blog → threads, YouTube → newsletter, podcast → clips",
  keywords: [
    "repurpose content", "repurpose", "content repurposing", "turn blog into",
    "convert content", "reformat content", "repurpose video", "repurpose post",
    "content remix", "atomize content",
  ],
}, handler);
