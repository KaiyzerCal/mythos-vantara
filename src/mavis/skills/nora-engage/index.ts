// SKILL: nora-engage
// Polls Twitter/X for Nora mentions and generates in-persona replies via mavis-nora-engage.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-nora-engage", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.replies ?? data?.engaged ?? data?.output;
    return { skillName: "nora-engage", output: result ? `💬 **Nora Engage:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "nora-engage", output: `Nora engage error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "nora-engage",
  description: "Polls Twitter/X for Nora mentions and DMs, generates in-persona replies via Claude",
  keywords: [
    "nora engage", "nora twitter replies", "engage as nora", "nora mentions",
    "reply as nora", "nora twitter engagement",
  ],
}, handler);
