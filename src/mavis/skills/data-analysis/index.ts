// SKILL: data-analysis
// Pattern from 500-AI-Agents #08 — natural language data analysis (Pandas Agent).
// Calls mavis-pattern-insights or mavis-finance for structured data interpretation.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "data-analysis", output: "Share the data or describe what you want analyzed — I'll interpret it, find patterns, and surface key insights." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-pattern-insights", {
      body: { userId: ctx.userId, query: input.trim() },
    });
    if (error) throw error;
    return { skillName: "data-analysis", output: data?.insights ?? data?.analysis ?? data?.output ?? JSON.stringify(data) };
  } catch {
    const { data, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: input }],
        systemPrompt: "You are a senior data analyst. When given data (CSV, JSON, tables, or descriptions of datasets), produce: (1) key findings and trends, (2) anomalies or outliers, (3) actionable insights ranked by business impact, (4) recommended next steps. Be quantitative and specific.",
        mode: "DATA",
        chatKind: "skill",
      },
    });
    if (chatErr) throw chatErr;
    return { skillName: "data-analysis", output: data?.content ?? "[No output]" };
  }
};

registerSkill({
  name: "data-analysis",
  description: "Analyzes datasets and metrics in natural language — patterns, trends, anomalies, and ranked recommendations",
  keywords: [
    "analyze this data", "data analysis", "analyze these numbers", "what do these numbers mean",
    "find patterns", "analyze metrics", "interpret this data", "data insights",
    "what does this data show", "KPI analysis", "metric analysis", "analyze my revenue",
  ],
}, handler);
