// SKILL: predict
// Runs AI-powered predictive analysis on trends and outcomes via mavis-predictive-engine.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "predict", output: "Get a prediction. Example: 'predict my revenue next quarter' or 'forecast user growth if I launch X feature'" };
  }
  const question = input.replace(/^(predict|forecast|prediction|predictive analysis)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-predictive-engine", {
      body: { question, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.prediction ?? data?.forecast ?? data?.output;
    return { skillName: "predict", output: result ? `🔮 **Prediction:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "predict", output: `Prediction error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "predict",
  description: "AI-powered predictive analysis — forecasts outcomes, trends, and scenarios",
  keywords: [
    "predict", "forecast", "prediction", "predictive analysis", "what will happen",
    "future forecast", "scenario forecast", "trend prediction", "predictive model",
  ],
}, handler);
