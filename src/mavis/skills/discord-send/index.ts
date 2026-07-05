// SKILL: discord-send
// Sends messages to Discord servers/channels via mavis-discord-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "discord-send", output: "Send a Discord message. Example: 'discord #announcements: New update is live!'" };
  }
  const channelMatch = input.match(/#([\w-]+)/);
  const channel = channelMatch?.[1] ?? "general";
  const message = input.replace(/^(send|post|discord|message)\s+/i, "").replace(/#[\w-]+:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-discord-agent", {
      body: { action: "send_message", channel, content: message },
    });
    if (error) throw error;
    const ok = data?.success ?? data?.id ?? !data?.error;
    return { skillName: "discord-send", output: ok ? `🎮 Discord message sent to #${channel}` : `Discord error: ${JSON.stringify(data)}` };
  } catch (err) {
    return { skillName: "discord-send", output: `Discord error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "discord-send",
  description: "Sends messages to Discord servers and channels",
  keywords: [
    "discord message", "send discord", "post on discord", "discord notification",
    "discord channel", "discord server", "notify discord", "discord update",
    "message discord", "post to discord",
  ],
}, handler);
