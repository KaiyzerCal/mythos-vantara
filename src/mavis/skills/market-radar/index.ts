// SKILL: market-radar
// Scans markets for opportunities, signals, and emerging trends via mavis-market-radar.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "market-radar", output: "Scan markets for signals. Example: 'market radar AI sector' or 'market opportunities in fintech'" };
  }
  const sector = input.replace(/^(market radar|market scan|market opportunities|scan market)\s*(in\s+|for\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-market-radar", {
      body: { sector, analysis_type: "opportunities" },
    });
    if (error) throw error;
    const result = data?.signals ?? data?.opportunities ?? data?.analysis ?? data?.output;
    return { skillName: "market-radar", output: result ? `📡 **Market Radar:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "market-radar", output: `Market radar error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "market-radar",
  description: "Scans markets for emerging opportunities, signals, and trend shifts",
  keywords: [
    "market radar", "market scan", "market opportunities", "market signals",
    "emerging markets", "market trends", "sector analysis", "market intelligence",
    "market opportunity", "industry trends",
  ],
}, handler);
