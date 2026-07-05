// SKILL: youtube-agent
// YouTube search, transcript fetch, and channel analytics via mavis-youtube-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "youtube-agent", output: "Interact with YouTube. Example: 'youtube search AI trends' or 'get transcript of https://youtube.com/watch?v=...' or 'channel stats for @mkbhd'" };
  }
  const query = input.replace(/^(youtube|yt)\s*(search|transcript|stats|analyze)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-youtube-agent", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.results ?? data?.transcript ?? data?.output;
    return { skillName: "youtube-agent", output: result ? `▶️ **YouTube:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "youtube-agent", output: `YouTube agent error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "youtube-agent",
  description: "YouTube search, transcript extraction, channel analytics, and video summaries",
  keywords: [
    "youtube search", "youtube transcript", "yt transcript", "youtube video",
    "channel analytics", "youtube stats", "get youtube transcript", "youtube agent",
  ],
}, handler);
