// SKILL: earnings-predict
// AI earnings prediction and alpha signals via Apify data_voyager/alphascrape.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "earnings-predict", output: "Get earnings predictions. Example: 'earnings prediction AAPL' or 'alpha signals for MSFT' or 'alphascrape NVDA'" };
  }
  const ticker = input.match(/\b[A-Z]{1,5}\b/)?.[0] ?? input.replace(/^(earnings prediction|alpha signals for|alphascrape|earnings predict)\s*/i, "").trim().toUpperCase();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "data_voyager/alphascrape", input: { ticker }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.prediction ?? data;
    return { skillName: "earnings-predict", output: result ? `🎯 **Alpha Signals (${ticker}):**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "earnings-predict", output: `Earnings prediction error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "earnings-predict",
  description: "AI earnings predictions and alpha signals — sentiment, estimates, surprise probability",
  keywords: [
    "earnings prediction", "alpha signals", "earnings estimate", "stock prediction",
    "earnings surprise", "alphascrape", "earnings forecast",
  ],
}, handler);
