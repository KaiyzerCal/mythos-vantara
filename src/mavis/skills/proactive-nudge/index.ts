// SKILL: proactive-nudge
// Sends scheduled Claude-generated goal/habit nudges via Telegram (mavis-proactive-nudge).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "proactive-nudge", output: "Send a proactive nudge. Example: 'proactive nudge: remind me about my running goal' or 'send nudge for my top goal'" };
  }
  const context = input.replace(/^(proactive nudge|send nudge|nudge me about)\s*:?\s*/i, "").trim() || "top active goal";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-proactive-nudge", {
      body: { context, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.nudge ?? data?.sent ?? data?.output;
    return { skillName: "proactive-nudge", output: result ? `💪 **Nudge Sent:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "proactive-nudge", output: `Proactive nudge error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "proactive-nudge",
  description: "Sends Claude-generated proactive nudges for goals and habits via Telegram",
  keywords: [
    "proactive nudge", "send nudge", "nudge me", "goal nudge", "habit nudge",
    "remind me proactively", "motivational nudge",
  ],
}, handler);
