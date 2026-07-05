// SKILL: relationship-intel
// Contact health scoring, dormancy detection, and nurture suggestions via mavis-relationship-intel.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "relationship-intel", output: "Get relationship intelligence. Example: 'relationship intel' or 'who should I follow up with?' or 'relationship health report'" };
  }
  const query = input.replace(/^(relationship intel|relationship intelligence|who should i follow up|contact health)\s*:?\s*/i, "").trim() || "overview";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-relationship-intel", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.contacts ?? data?.report ?? data?.output;
    return { skillName: "relationship-intel", output: result ? `🤝 **Relationship Intel:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "relationship-intel", output: `Relationship intel error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "relationship-intel",
  description: "CRM intelligence — contact health scores, dormancy detection, who to follow up with and how",
  keywords: [
    "relationship intel", "relationship intelligence", "who to follow up", "contact health",
    "follow up with", "dormant contacts", "relationship score", "nurture contacts",
    "crm intelligence", "who should i reach out to",
  ],
}, handler);
