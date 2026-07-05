// SKILL: multi-provider
// Unified gateway to Anthropic/OpenAI/Gemini/DeepSeek/Groq/Mistral/xAI/Ollama via mavis-multi-provider.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "multi-provider", output: "Query any AI provider. Example: 'ask deepseek: explain quantum entanglement' or 'use groq: fast response needed'" };
  }
  const provider = /deepseek/i.test(input) ? "deepseek" : /groq/i.test(input) ? "groq" : /mistral/i.test(input) ? "mistral" : /grok|xai/i.test(input) ? "xai" : /gemini/i.test(input) ? "gemini" : /ollama/i.test(input) ? "ollama" : /gpt|openai/i.test(input) ? "openai" : "auto";
  const query = input.replace(/^(ask deepseek|ask groq|ask mistral|ask grok|ask gemini|ask ollama|ask gpt|use deepseek|use groq|use mistral|use gemini|multi provider)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-multi-provider", {
      body: { query, provider, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.response ?? data?.output;
    return { skillName: "multi-provider", output: result ? `🌐 **Multi-Provider (${provider}):**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "multi-provider", output: `Multi-provider error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "multi-provider",
  description: "Unified gateway to any AI provider — Anthropic, OpenAI, Gemini, DeepSeek, Groq, Mistral, xAI, Ollama",
  keywords: [
    "ask deepseek", "ask groq", "ask mistral", "ask grok", "use groq",
    "multi provider", "other ai", "different model", "use deepseek", "use ollama",
  ],
}, handler);
