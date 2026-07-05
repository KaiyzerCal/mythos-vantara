// SKILL: vision-agent
// Analyzes images, screenshots, and visual content via mavis-vision-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "vision-agent", output: "Give me an image URL and what to analyze. Example: 'analyze this image: https://example.com/chart.png' or 'describe what you see in [url]'" };
  }
  const urlMatch = input.match(/https?:\/\/[^\s)]+(?:\.(?:png|jpg|jpeg|gif|webp|svg))?[^\s)]*/i);
  if (!urlMatch) return { skillName: "vision-agent", output: "Please include an image URL to analyze." };
  const task = input.replace(urlMatch[0], "").replace(/^(analyze|describe|what do you see in|look at|vision|inspect)\s*/i, "").trim() || "Describe this image in detail";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-vision-agent", {
      body: { image_url: urlMatch[0], task },
    });
    if (error) throw error;
    const result = data?.analysis ?? data?.description ?? data?.output;
    return { skillName: "vision-agent", output: result ? `👁️ **Vision Analysis:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "vision-agent", output: `Vision agent error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "vision-agent",
  description: "Analyzes images, diagrams, screenshots, and visual content with AI",
  keywords: [
    "analyze this image", "what's in this image", "describe this image",
    "look at this", "vision analysis", "what do you see", "read this screenshot",
    "analyze screenshot", "describe photo", "what is in this picture",
  ],
}, handler);
