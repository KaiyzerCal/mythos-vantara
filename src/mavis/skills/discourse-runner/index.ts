// SKILL: discourse-runner
// Runs a multi-stage council debate: positions → challenges → synthesis via mavis-discourse-runner.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "discourse-runner", output: "Run a structured council debate. Example: 'discourse: should I raise venture capital or bootstrap?' or 'debate this: hiring a CMO vs outsourcing marketing'" };
  }
  const question = input.replace(/^(discourse|council debate|discourse runner|debate this|structured debate)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-discourse-runner", {
      body: { question, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.synthesis ?? data?.discourse ?? data?.output;
    return { skillName: "discourse-runner", output: result ? `⚖️ **Council Discourse:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 6000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "discourse-runner", output: `Discourse error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "discourse-runner",
  description: "Structured multi-stage council debate — positions, adversarial challenges, then MAVIS synthesis",
  keywords: [
    "discourse", "council debate", "structured debate", "debate this", "positions and challenges",
    "multi-stage debate", "discourse runner", "intellectual debate",
  ],
}, handler);
