// SKILL: prymal-onboard
// Onboards new Prymal team members or customers via prymal-onboard.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "prymal-onboard", output: "Onboard to Prymal. Example: 'prymal onboard new team member: name@email.com' or 'onboard prymal customer: John Doe'" };
  }
  const contact = input.replace(/^(prymal onboard|onboard prymal)\s*(new\s+)?(team member|customer)?\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("prymal-onboard", {
      body: { contact, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.onboarded ?? data?.status ?? data?.output;
    return { skillName: "prymal-onboard", output: result ? `🚀 **Prymal Onboard:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "prymal-onboard", output: `Prymal onboard error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "prymal-onboard",
  description: "Onboards Prymal team members or customers — sends welcome materials and sets up access",
  keywords: [
    "prymal onboard", "onboard prymal", "prymal new member", "prymal customer onboard",
    "prymal team onboard", "prymal welcome", "prymal signup flow",
  ],
}, handler);
