// SKILL: funding-intel
// Startup funding intelligence — rounds, investors, valuations via Apify fiery_dream/funding-intel.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "funding-intel", output: "Research startup funding. Example: 'funding intel: AI startups Series A 2024' or 'who funded Anthropic?' or 'funding rounds for fintech'" };
  }
  const query = input.replace(/^(funding intel|funding intelligence|who funded)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "fiery_dream/funding-intel", input: { query }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.funding ?? data;
    return { skillName: "funding-intel", output: result ? `💰 **Funding Intelligence:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "funding-intel", output: `Funding intel error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "funding-intel",
  description: "Startup funding intelligence — rounds, investors, valuations, Crunchbase-style data",
  keywords: [
    "funding intel", "startup funding", "who funded", "funding rounds",
    "investor data", "vc funding", "startup investors",
  ],
}, handler);
