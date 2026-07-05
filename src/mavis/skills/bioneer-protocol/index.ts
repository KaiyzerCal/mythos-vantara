// SKILL: bioneer-protocol
// Personalized biohacking and optimization protocol builder via mavis-chat.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "bioneer-protocol", output: "Build a biohacking protocol. Example: 'bioneer protocol: optimize sleep and focus for entrepreneur' or 'biohacking stack for: energy and longevity'" };
  }
  const goal = input.replace(/^(bioneer protocol|biohacking stack for|bioneer)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: goal }],
        systemPrompt: "You are a science-backed biohacking and human optimization expert. Build a personalized protocol for the given goal. Include: morning routine, supplementation stack (with dosages), sleep optimization, nutrition strategy, exercise approach, and measurement metrics. Cite mechanisms of action. Be specific and evidence-based.",
        mode: "PRIME",
        chatKind: "skill",
        user_id: ctx.userId,
      },
    });
    if (error) throw error;
    const result = data?.message ?? data?.output ?? data?.content;
    return { skillName: "bioneer-protocol", output: result ? `🧬 **Bioneer Protocol:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 6000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "bioneer-protocol", output: `Bioneer error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "bioneer-protocol",
  description: "Science-backed biohacking protocols — sleep, focus, energy, longevity optimization stacks",
  keywords: [
    "bioneer protocol", "biohacking", "biohacking stack", "optimization protocol",
    "human optimization", "supplement stack", "bioneer", "longevity protocol",
  ],
}, handler);
