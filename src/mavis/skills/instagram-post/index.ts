// SKILL: instagram-post
// Writes Instagram captions and posts via mavis-nora-instagram.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "instagram-post", output: "Tell me the topic or image idea. Example: 'write an instagram caption for a product photo' or 'create instagram content about fitness'" };
  }
  const topic = input.replace(/^(write|create|draft|post)\s+(an?\s+)?(instagram caption|instagram post|caption for|ig post)\s+(for|about|on)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-nora-instagram", {
      body: { action: "draft", topic, user_id: ctx.userId, include_hashtags: true },
    });
    if (error) throw error;
    const content = data?.caption ?? data?.post ?? data?.content ?? data?.output;
    return {
      skillName: "instagram-post",
      output: content ? `📸 **Instagram Caption:**\n\n${content}` : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "instagram-post", output: `Instagram error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "instagram-post",
  description: "Writes Instagram captions, stories, and post content with hashtags",
  keywords: [
    "instagram caption", "instagram post", "ig caption", "write for instagram",
    "instagram content", "post on instagram", "instagram story", "ig post",
    "instagram copy", "hashtags for", "caption for photo",
  ],
}, handler);
