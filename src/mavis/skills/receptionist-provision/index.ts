// SKILL: receptionist-provision
// Provisions a new MAVIS AI receptionist instance with phone number via mavis-receptionist-provision.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const name = input?.replace(/^(provision receptionist|create receptionist|new receptionist)\s*:?\s*/i, "").trim() || "MAVIS Receptionist";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-receptionist-provision", {
      body: { name, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.receptionist ?? data?.phone ?? data?.output;
    return { skillName: "receptionist-provision", output: result ? `📱 **Receptionist Provisioned:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "receptionist-provision", output: `Receptionist provision error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "receptionist-provision",
  description: "Provisions a new AI receptionist with a dedicated phone number and MAVIS brain",
  keywords: [
    "provision receptionist", "create receptionist", "new receptionist",
    "deploy receptionist", "receptionist provision", "setup ai receptionist",
  ],
}, handler);
