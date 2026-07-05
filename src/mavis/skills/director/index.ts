// SKILL: director
// Native Claude tool-use routing: classifies intent and dispatches to the right pipeline via mavis-director.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "director", output: "Direct a complex task to the right agent. Example: 'direct: write a blog post and post it to my social media' or 'route this task to the best agent'" };
  }
  const task = input.replace(/^(direct|director|route task|dispatch)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-director", {
      body: { task, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.result ?? data?.output ?? data?.dispatch;
    return { skillName: "director", output: result ? `🎬 **Director:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "director", output: `Director error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "director",
  description: "Classifies any complex task and routes it to the optimal agent pipeline using Claude tool-use",
  keywords: [
    "director", "route task", "dispatch task", "direct this", "best agent for",
    "auto route", "smart dispatch", "intelligent routing",
  ],
}, handler);
