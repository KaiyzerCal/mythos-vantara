// SKILL: proactive-brief
// Full morning brief from email + calendar + tasks + memory via mavis-proactive-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-proactive-agent", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.brief ?? data?.output;
    return { skillName: "proactive-brief", output: result ? `🌅 **Proactive Brief:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 6000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "proactive-brief", output: `Proactive brief error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "proactive-brief",
  description: "Full proactive morning brief — pulls email, calendar, tasks, memory, and synthesizes with Claude",
  keywords: [
    "proactive brief", "full morning brief", "complete brief", "proactive morning",
    "smart morning brief", "ai morning brief", "daily intelligence",
  ],
}, handler);
