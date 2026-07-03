// SKILL: stock-research
// Pattern from 500-AI-Agents #11 — stock/investment research agent.
// Calls mavis-stock-analysis for ticker-specific research.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "stock-research", output: "Give me a ticker or company name and I'll pull a full research report." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-stock-analysis", {
      body: { query: input.trim() },
    });
    if (error) throw error;
    return { skillName: "stock-research", output: data?.report ?? data?.analysis ?? data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "stock-research", output: `Stock research failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "stock-research",
  description: "Pulls a structured investment research report for any stock ticker or company",
  keywords: [
    "stock", "ticker", "shares", "invest in", "stock analysis", "equity research",
    "analyze aapl", "analyze tsla", "what's the stock", "stock price", "market cap",
    "investment research", "should i buy", "bull case", "bear case",
  ],
}, handler);
