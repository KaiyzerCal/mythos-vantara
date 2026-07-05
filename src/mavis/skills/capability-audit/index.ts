// SKILL: capability-audit
// Scans all connected integrations and saves a live capability snapshot via mavis-capability-audit.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-capability-audit", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.capabilities ?? data?.snapshot ?? data?.output;
    return { skillName: "capability-audit", output: result ? `🔍 **Capability Audit:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "capability-audit", output: `Capability audit error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "capability-audit",
  description: "Audits all connected integrations, active cron jobs, and skill types — saves live capability snapshot",
  keywords: [
    "capability audit", "what can you do", "audit capabilities", "scan integrations",
    "what's connected", "integration audit", "capability check", "system audit",
  ],
}, handler);
