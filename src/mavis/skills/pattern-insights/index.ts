// SKILL: pattern-insights
// Finds patterns and behavioral insights in data via mavis-pattern-insights.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "pattern-insights", output: "Tell me what to analyze for patterns. Example: 'find patterns in my spending' or 'analyze my productivity patterns this week'" };
  }
  const domain = /spending|financial|expense/i.test(input) ? "finance"
    : /productivity|work|task/i.test(input) ? "productivity"
    : /health|sleep|fitness/i.test(input) ? "health"
    : /habit/i.test(input) ? "habits"
    : "general";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-pattern-insights", {
      body: { query: input.trim(), domain, user_id: ctx.userId, lookback_days: 30 },
    });
    if (error) throw error;
    const result = data?.insights ?? data?.patterns ?? data?.result ?? data?.output;
    return { skillName: "pattern-insights", output: result ? `🔎 **Pattern Insights:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "pattern-insights", output: `Pattern analysis failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "pattern-insights",
  description: "Finds patterns and trends in your behavior, spending, productivity, and health data",
  keywords: [
    "find patterns", "analyze patterns", "behavioral patterns", "trend analysis",
    "what patterns", "insights from my data", "productivity patterns",
    "habit patterns", "spending patterns", "data trends",
  ],
}, handler);
