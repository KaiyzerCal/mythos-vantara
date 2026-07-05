// SKILL: prymal-intel
// Market and competitor intelligence for Prymal brand via prymal-intel-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "prymal-intel", output: "Get Prymal market intelligence. Example: 'prymal intel: competitor analysis' or 'prymal market trends' or 'prymal amazon reviews analysis'" };
  }
  const query = input.replace(/^(prymal intel|prymal intelligence|prymal market)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("prymal-intel-agent", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.intel ?? data?.report ?? data?.output;
    return { skillName: "prymal-intel", output: result ? `🔍 **Prymal Intelligence:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "prymal-intel", output: `Prymal intel error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "prymal-intel",
  description: "Market and competitor intelligence for Prymal — Amazon reviews, competitor analysis, trends",
  keywords: [
    "prymal intel", "prymal intelligence", "prymal competitor", "prymal market",
    "prymal trends", "prymal research", "prymal amazon analysis",
  ],
}, handler);
