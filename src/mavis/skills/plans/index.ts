// SKILL: plans
// Creates and manages persistent multi-session goal plans via mavis-plans.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "plans", output: "Manage your plans. Example: 'create plan: launch my app' or 'show my plans' or 'advance plan: [plan name]'" };
  }
  const action = /show|list|get|my plans/i.test(input) ? "list"
    : /create|new|start/i.test(input) ? "create"
    : /advance|next step|complete step/i.test(input) ? "advance"
    : /complete|done|finish/i.test(input) ? "complete"
    : "list";
  const content = input.replace(/^(create plan|new plan|show plans|my plans|plans|advance plan|plan)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-plans", {
      body: { action, content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.plans ?? data?.plan ?? data?.output;
    return { skillName: "plans", output: result ? `📋 **Plans:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "plans", output: `Plans error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "plans",
  description: "Creates and manages persistent multi-session plans with ordered steps that persist across conversations",
  keywords: [
    "my plans", "create plan", "new plan", "show plans", "plan list",
    "advance plan", "next step in plan", "complete plan", "plan steps",
  ],
}, handler);
