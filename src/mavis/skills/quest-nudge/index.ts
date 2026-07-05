// SKILL: quest-nudge
// Surfaces quests due in 24–48h via Telegram via mavis-quest-nudge.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-quest-nudge", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.quests ?? data?.nudges ?? data?.output;
    return { skillName: "quest-nudge", output: result ? `⚔️ **Quest Nudge:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "quest-nudge", output: `Quest nudge error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "quest-nudge",
  description: "Surfaces quests due in the next 24–48 hours and sends deadline alerts via Telegram",
  keywords: [
    "quest nudge", "quest deadline", "due quests", "upcoming quests",
    "quests due soon", "quest reminder", "quest alerts",
  ],
}, handler);
