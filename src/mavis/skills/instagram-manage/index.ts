// SKILL: instagram-manage
// Instagram Business management: list media, reply to comments, publish images via mavis-instagram-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "instagram-manage", output: "Manage Instagram. Example: 'instagram comments: reply to recent' or 'instagram media: show my posts' or 'instagram publish: [image url] [caption]'" };
  }
  const action = /comment|reply/i.test(input) ? "reply_comments"
    : /media|posts|show/i.test(input) ? "list_media"
    : /publish|post/i.test(input) ? "publish"
    : "list_media";
  const content = input.replace(/^(instagram manage|instagram comments|instagram media|instagram publish|manage instagram)\s*:?\s*/i, "").trim() || "";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-instagram-agent", {
      body: { action, content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.media ?? data?.comments ?? data?.published ?? data?.output;
    return { skillName: "instagram-manage", output: result ? `📸 **Instagram Manager:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "instagram-manage", output: `Instagram manage error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "instagram-manage",
  description: "Full Instagram Business management — view media, AI-reply to comments, publish images",
  keywords: [
    "instagram manage", "instagram comments", "reply instagram comments", "instagram media",
    "manage instagram", "instagram business", "instagram engagement", "reply to comments",
  ],
}, handler);
