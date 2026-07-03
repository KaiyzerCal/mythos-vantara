// SKILL: social-content
// Generates platform-optimized social media content using mavis-nora-post or direct LLM.
// Pattern adapted from 500-AI-Agents-Projects #14 (social media content agent).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const PLATFORMS = ["twitter", "linkedin", "instagram", "tiktok", "threads"];

function detectPlatform(input: string): string {
  const lower = input.toLowerCase();
  return PLATFORMS.find(p => lower.includes(p)) ?? "all";
}

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return {
      skillName: "social-content",
      output: "Tell me the topic and platform (Twitter, LinkedIn, Instagram, TikTok) and I'll generate platform-optimized content.",
    };
  }
  const platform = detectPlatform(input);
  try {
    const { data, error } = await supabase.functions.invoke("mavis-nora-post", {
      body: { topic: input.trim(), platform, mode: "generate" },
    });
    if (error) throw error;
    const output = data?.content ?? data?.post ?? data?.output ?? JSON.stringify(data);
    return { skillName: "social-content", output };
  } catch {
    // Fallback: direct LLM call via mavis-chat
    const { data, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: input }],
        systemPrompt: `You are a social media expert. Generate engaging, platform-native content for ${platform}. Include hooks, hashtags where appropriate, and tailor length/tone to the platform. Output ONLY the post content, ready to copy-paste.`,
        mode: "MARKET",
        chatKind: "skill",
      },
    });
    if (chatErr) throw chatErr;
    return { skillName: "social-content", output: data?.content ?? "[No output]" };
  }
};

registerSkill({
  name: "social-content",
  description: "Generates platform-optimized social media posts for Twitter/X, LinkedIn, Instagram, TikTok, and Threads",
  keywords: [
    "write a post", "social media post", "tweet", "linkedin post", "instagram caption",
    "tiktok script", "threads post", "content for", "create content", "draft a post",
    "social content", "post about", "write content for",
  ],
}, handler);
