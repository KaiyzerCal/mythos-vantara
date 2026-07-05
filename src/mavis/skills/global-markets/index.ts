// SKILL: global-markets
// Global markets intelligence — macro, geopolitical, sector analysis via Apify visita/global-markets-intelligence.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "global-markets", output: "Get global market intelligence. Example: 'global markets today' or 'market intelligence: emerging markets' or 'global macro outlook'" };
  }
  const query = input.replace(/^(global markets|market intelligence|global macro)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "visita/global-markets-intelligence", input: { query }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.intelligence ?? data;
    return { skillName: "global-markets", output: result ? `🌍 **Global Markets Intelligence:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "global-markets", output: `Global markets error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "global-markets",
  description: "Global markets intelligence — macro trends, geopolitical risks, sector analysis",
  keywords: [
    "global markets", "market intelligence", "global macro", "macro outlook",
    "world markets", "geopolitical risk", "global market analysis",
  ],
}, handler);
