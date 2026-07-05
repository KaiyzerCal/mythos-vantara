// SKILL: blotato
// Schedules and publishes social media content via Blotato (mavis-blotato).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "blotato", output: "Schedule content with Blotato. Example: 'blotato schedule: post my LinkedIn article tomorrow at 9am' or 'blotato publish this tweet now'" };
  }
  const action = input.replace(/^(blotato|blotato schedule|blotato publish)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-blotato", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.scheduled ?? data?.post ?? data?.status ?? data?.output;
    return { skillName: "blotato", output: result ? `📅 **Blotato:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "blotato", output: `Blotato error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "blotato",
  description: "Schedules and publishes social content across platforms via Blotato",
  keywords: [
    "blotato", "blotato schedule", "schedule content", "blotato post",
    "social scheduling", "content calendar blotato", "publish via blotato",
  ],
}, handler);
