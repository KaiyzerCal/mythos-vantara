// SKILL: critic-agent
// Provides critical evaluation and adversarial critique of any idea or plan via mavis-critic-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "critic-agent", output: "Get critical feedback. Example: 'critique my business plan: ...' or 'critic: poke holes in this strategy'" };
  }
  const content = input.replace(/^(critic|critique|critical review|poke holes|adversarial review)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-critic-agent", {
      body: { content, mode: "adversarial" },
    });
    if (error) throw error;
    const result = data?.critique ?? data?.feedback ?? data?.output;
    return { skillName: "critic-agent", output: result ? `🔥 **Critic Agent:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "critic-agent", output: `Critic agent error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "critic-agent",
  description: "Provides honest, adversarial critique of ideas, plans, content, and strategies",
  keywords: [
    "critique", "critic", "critical feedback", "poke holes", "adversarial review",
    "what's wrong with", "find flaws", "critique my", "critical analysis",
    "devil's advocate", "challenge this", "critic agent",
  ],
}, handler);
