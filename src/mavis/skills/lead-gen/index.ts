// SKILL: lead-gen
// Calls mavis-lead-gen to generate targeted prospect lists and outreach strategies.
// Pattern from 500-AI-Agents #18 (job/recruitment) adapted for business development.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "lead-gen", output: "Describe your ideal client or prospect and I'll generate a targeted list and outreach strategy." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-lead-gen", {
      body: { criteria: input.trim() },
    });
    if (error) throw error;
    return { skillName: "lead-gen", output: data?.leads ?? data?.results ?? data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "lead-gen", output: `Lead gen failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "lead-gen",
  description: "Generates targeted prospect lists and outreach strategies based on your ideal client profile",
  keywords: [
    "find leads", "generate leads", "lead generation", "prospect list", "find prospects",
    "who should i target", "ideal client", "target audience", "find customers",
    "sales leads", "outreach list", "business development", "find clients",
  ],
}, handler);
