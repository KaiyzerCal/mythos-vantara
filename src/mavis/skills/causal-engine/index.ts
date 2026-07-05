// SKILL: causal-engine
// Performs causal reasoning and root-cause analysis via mavis-causal-engine.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "causal-engine", output: "Analyze cause and effect. Example: 'why did my sales drop last month?' or 'causal analysis of why users are churning'" };
  }
  const question = input.replace(/^(causal analysis|root cause|why did|causal reasoning)\s+(of\s+)?(for\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-causal-engine", {
      body: { question, analysis_depth: "thorough" },
    });
    if (error) throw error;
    const result = data?.causal_chain ?? data?.root_causes ?? data?.analysis ?? data?.output;
    return { skillName: "causal-engine", output: result ? `🔗 **Causal Analysis:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "causal-engine", output: `Causal engine error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "causal-engine",
  description: "Performs deep causal reasoning and root-cause analysis on any problem",
  keywords: [
    "why did", "root cause", "causal analysis", "cause of", "what caused",
    "causal reasoning", "why is this happening", "first principles cause",
    "causal chain", "root cause analysis", "5 whys",
  ],
}, handler);
