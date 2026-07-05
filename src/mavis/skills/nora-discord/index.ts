// SKILL: nora-discord
// Posts Nora persona content to Discord via webhook via mavis-nora-discord.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "nora-discord", output: "Post Nora to Discord. Example: 'nora discord: share today's AI insights in the tech channel' or 'post nora to discord: [message]'" };
  }
  const content = input.replace(/^(nora discord|post nora to discord|discord nora)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-nora-discord", {
      body: { content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.posted ?? data?.status ?? data?.output;
    return { skillName: "nora-discord", output: result ? `💬 **Nora → Discord:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "nora-discord", output: `Nora Discord error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "nora-discord",
  description: "Posts Nora persona content to Discord channel via webhook",
  keywords: [
    "nora discord", "post nora discord", "discord nora", "send to discord as nora",
    "nora on discord",
  ],
}, handler);
