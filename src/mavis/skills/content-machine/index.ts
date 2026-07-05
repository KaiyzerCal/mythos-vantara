// SKILL: content-machine
// Full content calendar and batch content creation engine via mavis-chat.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "content-machine", output: "Run the content machine. Example: 'content machine: 30 days of instagram posts for a coffee brand' or 'batch content: 10 linkedin posts about AI'" };
  }
  const brief = input.replace(/^(content machine|batch content)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: brief }],
        systemPrompt: "You are a professional content strategist and copywriter. Create a complete batch of high-quality, platform-optimized content pieces based on the brief. Include variety in hooks, formats, and angles. Output each piece clearly labeled and ready to publish.",
        mode: "PRIME",
        chatKind: "skill",
        user_id: ctx.userId,
      },
    });
    if (error) throw error;
    const result = data?.message ?? data?.output ?? data?.content;
    return { skillName: "content-machine", output: result ? `🏭 **Content Machine:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 6000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "content-machine", output: `Content machine error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "content-machine",
  description: "Batch content creation engine — generates 10–30 platform-ready posts from a single brief",
  keywords: [
    "content machine", "batch content", "content calendar", "bulk content",
    "content batch", "30 day content", "content creation engine",
  ],
}, handler);
