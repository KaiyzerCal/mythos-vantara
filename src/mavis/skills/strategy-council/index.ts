// SKILL: strategy-council
// Convenes a multi-perspective strategy council for complex decisions via mavis-strategy-council.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "strategy-council", output: "Get multi-perspective strategic advice. Example: 'strategy council: should I raise a seed round now?' or 'council session on pricing strategy'" };
  }
  const question = input.replace(/^(strategy council|council session|strategic council|convene council)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-strategy-council", {
      body: { question, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.council ?? data?.perspectives ?? data?.synthesis ?? data?.output;
    return { skillName: "strategy-council", output: result ? `🏛️ **Strategy Council:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "strategy-council", output: `Strategy council error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "strategy-council",
  description: "Convenes a virtual strategy council with multiple expert perspectives on complex decisions",
  keywords: [
    "strategy council", "council session", "strategic advice", "get perspectives",
    "multiple viewpoints", "council on", "strategic decision", "expert council",
    "multi-perspective analysis", "convene council",
  ],
}, handler);
