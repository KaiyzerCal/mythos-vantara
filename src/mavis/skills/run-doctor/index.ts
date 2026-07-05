// SKILL: run-doctor
// Diagnoses MAVIS runtime health — edge functions, memory, integrations via mavis-run-doctor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-run-doctor", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.report ?? data?.health ?? data?.output;
    return { skillName: "run-doctor", output: result ? `🩺 **System Health Report:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "run-doctor", output: `Run doctor error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "run-doctor",
  description: "Diagnoses MAVIS runtime health — edge functions, memory, integrations, latency",
  keywords: [
    "run doctor", "system health", "mavis health check", "diagnose mavis",
    "check system status", "mavis diagnostics", "health report",
  ],
}, handler);
