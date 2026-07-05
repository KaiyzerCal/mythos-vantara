// SKILL: galaxy-ring
// Syncs Samsung Galaxy Ring biometric data into MAVIS health memory via mavis-galaxy-ring.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-galaxy-ring", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.biometrics ?? data?.health ?? data?.output;
    return { skillName: "galaxy-ring", output: result ? `💍 **Galaxy Ring Sync:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "galaxy-ring", output: `Galaxy Ring error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "galaxy-ring",
  description: "Syncs Samsung Galaxy Ring biometrics — sleep, HRV, stress, activity into MAVIS",
  keywords: [
    "galaxy ring", "sync galaxy ring", "samsung ring", "ring health data",
    "galaxy ring sync", "biometric ring", "samsung health ring",
  ],
}, handler);
