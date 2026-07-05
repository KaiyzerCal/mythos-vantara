// SKILL: prymal-approve
// Runs Prymal brand content through approval flow via prymal-approval-flow.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "prymal-approve", output: "Submit Prymal content for approval. Example: 'prymal approve: [content to approve]' or 'approve prymal post: [caption]'" };
  }
  const content = input.replace(/^(prymal approve|approve prymal post|prymal approval)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("prymal-approval-flow", {
      body: { content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.decision ?? data?.approved ?? data?.output;
    return { skillName: "prymal-approve", output: result ? `✅ **Prymal Approval:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "prymal-approve", output: `Prymal approval error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "prymal-approve",
  description: "Runs Prymal brand content through approval workflow — checks voice, compliance, brand fit",
  keywords: [
    "prymal approve", "approve prymal", "prymal approval", "prymal content approval",
    "prymal brand check", "approve prymal post", "prymal review",
  ],
}, handler);
