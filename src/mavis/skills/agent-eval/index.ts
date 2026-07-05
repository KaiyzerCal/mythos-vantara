// SKILL: agent-eval
// Weekly MAVIS quality evaluation — samples conversations and scores 5 rubrics via mavis-eval.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-eval", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.evaluation ?? data?.scores ?? data?.output;
    return { skillName: "agent-eval", output: result ? `🧪 **MAVIS Evaluation:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "agent-eval", output: `Agent eval error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "agent-eval",
  description: "Evaluates MAVIS performance — samples recent conversations and scores on 5 rubrics with Claude Haiku",
  keywords: [
    "agent eval", "evaluate mavis", "mavis eval", "mavis performance score",
    "quality check mavis", "how is mavis doing", "mavis rubric",
  ],
}, handler);
