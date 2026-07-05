// SKILL: social-publish
// Full AI social pipeline: one URL → Facebook+LinkedIn+Instagram+Twitter+TikTok in parallel via mavis-social-publisher.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "social-publish", output: "Publish across all social platforms. Example: 'social publish: https://myblog.com/article' or 'publish everywhere: [content]'" };
  }
  const content = input.replace(/^(social publish|publish everywhere|cross-post|publish all)\s*:?\s*/i, "").trim() || input;
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-social-publisher", {
      body: { content, source_url: url, user_id: ctx.userId, platforms: ["twitter", "linkedin", "instagram", "facebook", "tiktok"] },
    });
    if (error) throw error;
    const result = data?.published ?? data?.results ?? data?.output;
    return { skillName: "social-publish", output: result ? `📢 **Published Everywhere:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "social-publish", output: `Social publish error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "social-publish",
  description: "Full AI social pipeline — one piece of content → all platforms (Twitter, LinkedIn, Instagram, TikTok, Facebook) simultaneously",
  keywords: [
    "social publish", "publish everywhere", "cross-post", "publish all platforms",
    "all social", "omni publish", "publish to all", "multi-platform publish",
  ],
}, handler);
