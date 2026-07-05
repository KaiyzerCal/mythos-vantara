// SKILL: instagram-trends
// Analyzes Instagram trends and viral content via mavis-instagram-trends.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "instagram-trends", output: "Research Instagram trends. Example: 'instagram trends for fitness' or 'what's trending on instagram right now'" };
  }
  const topic = input.replace(/^(instagram trends|trending on instagram|ig trends)\s*(for\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-instagram-trends", {
      body: { topic, limit: 20 },
    });
    if (error) throw error;
    const result = data?.trends ?? data?.posts ?? data?.output;
    return { skillName: "instagram-trends", output: result ? `📸 **Instagram Trends:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "instagram-trends", output: `Instagram trends error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "instagram-trends",
  description: "Analyzes Instagram trends, viral content, and hashtag performance",
  keywords: [
    "instagram trends", "trending instagram", "ig trends", "instagram viral",
    "instagram hashtags", "what's popular on instagram", "instagram analytics",
    "instagram research", "reels trends",
  ],
}, handler);
