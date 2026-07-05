// SKILL: reflection-agent
// MAVIS weekly self-performance review: task success, goal velocity, revenue trends via mavis-reflection-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-reflection-agent", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.reflection ?? data?.report ?? data?.output;
    return { skillName: "reflection-agent", output: result ? `🪞 **MAVIS Reflection:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "reflection-agent", output: `Reflection agent error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "reflection-agent",
  description: "MAVIS weekly self-review — task success rate, goal velocity, revenue trends, new standing orders",
  keywords: [
    "reflection agent", "mavis reflection", "system review", "how is mavis performing",
    "ai performance review", "self reflection agent", "mavis performance",
  ],
}, handler);
