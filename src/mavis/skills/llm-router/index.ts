// SKILL: llm-router
// Routes requests to the optimal LLM provider (Gemini/Claude/GPT/DeepSeek) via mavis-llm-router.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "llm-router", output: "Route a query to the best AI model. Example: 'llm router: write a complex reasoning puzzle' or 'route to best model: analyze this code'" };
  }
  const query = input.replace(/^(llm router|route to best model|smart route|best model)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-llm-router", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.response ?? data?.output ?? data?.result;
    return { skillName: "llm-router", output: result ? `🔀 **LLM Router:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "llm-router", output: `LLM router error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "llm-router",
  description: "Routes queries to the optimal LLM — Gemini-free-first cascade with smart fallback by task type",
  keywords: [
    "llm router", "best model", "route to model", "smart model", "model router",
    "use gemini", "use claude", "use gpt", "route ai", "best ai for this",
  ],
}, handler);
