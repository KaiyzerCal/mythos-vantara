// SKILL: opportunity-scan
// Calls mavis-opportunity-scanner to surface business and personal growth opportunities
// based on current goals, market conditions, and user context.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-opportunity-scanner", {
      body: { userId: ctx.userId, focus: input?.trim() || "all" },
    });
    if (error) throw error;
    return { skillName: "opportunity-scan", output: data?.opportunities ?? data?.report ?? data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "opportunity-scan", output: `Opportunity scan failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "opportunity-scan",
  description: "Scans for business, revenue, and growth opportunities based on your goals and current context",
  keywords: [
    "opportunities", "find opportunities", "business opportunities", "what opportunities",
    "opportunity scan", "where should i focus", "revenue opportunities",
    "growth opportunities", "what's the opportunity", "what can i capitalize on",
  ],
}, handler);
