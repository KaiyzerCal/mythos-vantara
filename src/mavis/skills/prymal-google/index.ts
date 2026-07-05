// SKILL: prymal-google
// Manages Prymal Google Ads campaigns and analytics via prymal-google-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "prymal-google", output: "Manage Prymal Google presence. Example: 'prymal google ads report' or 'prymal search console data' or 'prymal google analytics'" };
  }
  const query = input.replace(/^(prymal google|prymal google ads|prymal analytics)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("prymal-google-agent", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.report ?? data?.data ?? data?.output;
    return { skillName: "prymal-google", output: result ? `📊 **Prymal Google:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "prymal-google", output: `Prymal Google error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "prymal-google",
  description: "Manages Prymal Google Ads, Analytics, and Search Console — reports and optimization",
  keywords: [
    "prymal google", "prymal google ads", "prymal analytics", "prymal gsc",
    "prymal search console", "prymal google report", "prymal ad performance",
  ],
}, handler);
