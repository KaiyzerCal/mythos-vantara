// SKILL: reclaim-ai
// Manages time blocking and smart scheduling via Reclaim.ai integration (mavis-reclaim).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "reclaim-ai", output: "Smart time blocking with Reclaim. Example: 'reclaim block 2 hours for deep work tomorrow' or 'schedule focus time this week'" };
  }
  const request = input.replace(/^(reclaim|reclaim ai|time block|block time|schedule focus)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-reclaim", {
      body: { request, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.scheduled ?? data?.blocks ?? data?.status ?? data?.output;
    return { skillName: "reclaim-ai", output: result ? `⏱️ **Reclaim Scheduling:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "reclaim-ai", output: `Reclaim error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "reclaim-ai",
  description: "Smart time blocking and scheduling via Reclaim.ai — protects focus time automatically",
  keywords: [
    "reclaim", "reclaim ai", "time block", "block time", "smart scheduling",
    "focus time", "deep work block", "protect time", "schedule focus",
  ],
}, handler);
