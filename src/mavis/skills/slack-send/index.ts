// SKILL: slack-send
// Sends messages to Slack channels or users via mavis-slack-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "slack-send", output: "Send a Slack message. Example: 'slack #general: Stand-up in 10 minutes' or 'message @alex on slack: Let's sync'" };
  }
  const channelMatch = input.match(/#([\w-]+)/);
  const userMatch = input.match(/@([\w.]+)/);
  const channel = channelMatch?.[1] ?? userMatch?.[1] ?? "general";
  const message = input.replace(/^(send|message|post|slack)\s+/i, "").replace(/#[\w-]+:?\s*/i, "").replace(/@[\w.]+:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-slack-agent", {
      body: { action: "send_message", channel, message },
    });
    if (error) throw error;
    const ok = data?.ok ?? data?.success ?? !data?.error;
    return { skillName: "slack-send", output: ok ? `💬 Slack message sent to #${channel}` : `Slack error: ${data?.error ?? JSON.stringify(data)}` };
  } catch (err) {
    return { skillName: "slack-send", output: `Slack error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "slack-send",
  description: "Sends messages to Slack channels or users",
  keywords: [
    "slack message", "send to slack", "post in slack", "slack notification",
    "message slack", "slack channel", "slack dm", "slack update",
    "notify slack", "alert slack", "message in slack",
  ],
}, handler);
