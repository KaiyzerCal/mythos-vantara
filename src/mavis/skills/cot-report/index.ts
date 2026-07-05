// SKILL: cot-report
// CFTC Commitment of Traders report visualizer via Apify bleffoo/cot-report-visualizer.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "cot-report", output: "Get COT report data. Example: 'cot report gold' or 'commitment of traders crude oil' or 'cot data for EUR/USD'" };
  }
  const commodity = input.replace(/^(cot report|commitment of traders|cot data for)\s*/i, "").trim() || "gold";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "bleffoo/cot-report-visualizer", input: { commodity }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.report ?? data;
    return { skillName: "cot-report", output: result ? `📊 **COT Report (${commodity}):**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "cot-report", output: `COT report error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "cot-report",
  description: "CFTC Commitment of Traders report — institutional positioning for commodities and forex",
  keywords: [
    "cot report", "commitment of traders", "cftc data", "cot data",
    "institutional positioning", "futures positioning", "cot gold",
  ],
}, handler);
