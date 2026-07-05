// SKILL: polymarket
// Queries Polymarket prediction markets for real-world probabilities via mavis-polymarket.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "polymarket", output: "Query Polymarket odds. Example: 'polymarket: will the Fed cut rates in 2025?' or 'prediction market odds for AI regulation'" };
  }
  const query = input.replace(/^(polymarket|prediction market|polymarket odds)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-polymarket", {
      body: { query, limit: 10 },
    });
    if (error) throw error;
    const result = data?.markets ?? data?.odds ?? data?.output;
    return { skillName: "polymarket", output: result ? `📊 **Polymarket:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "polymarket", output: `Polymarket error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "polymarket",
  description: "Queries Polymarket prediction markets for real-world event probabilities and odds",
  keywords: [
    "polymarket", "prediction market", "market odds", "probability", "prediction odds",
    "what are the odds", "polymarket odds", "forecast market", "betting odds",
  ],
}, handler);
