// SKILL: tiktok-post
// Writes TikTok scripts and captions via mavis-nora-tiktok.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "tiktok-post", output: "Tell me the idea and I'll write a TikTok script or caption. Example: 'tiktok script about morning routines' or 'write a tiktok caption for my cooking video'" };
  }
  const isScript = /script|video idea|hook/i.test(input);
  const topic = input.replace(/^(write|create|draft)\s+(a\s+)?(tiktok script|tiktok caption|tiktok post|tiktok|tt post)\s+(for|about|on)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-nora-tiktok", {
      body: { action: isScript ? "script" : "caption", topic, user_id: ctx.userId },
    });
    if (error) throw error;
    const content = data?.script ?? data?.caption ?? data?.content ?? data?.output;
    return {
      skillName: "tiktok-post",
      output: content ? `🎵 **TikTok ${isScript ? "Script" : "Caption"}:**\n\n${content}` : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "tiktok-post", output: `TikTok error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "tiktok-post",
  description: "Writes TikTok scripts, captions, and video concepts with trending hooks",
  keywords: [
    "tiktok", "tiktok script", "tiktok caption", "tiktok video idea",
    "tt caption", "write for tiktok", "tiktok content", "tiktok hook",
    "viral tiktok", "short form video script", "reels script",
  ],
}, handler);
