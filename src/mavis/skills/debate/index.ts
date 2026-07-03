// SKILL: debate
// Pattern from 500-AI-Agents #20 — multi-agent debate system.
// Calls mavis-strategy-council to run opposing-perspective analysis + judgment.
// Most useful for architectural decisions, business strategy, or evaluating tradeoffs.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "debate", output: "Give me a decision, topic, or proposal to debate (e.g. 'Should I build X or buy Y?'). I'll run opposing perspectives and deliver a verdict." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-strategy-council", {
      body: {
        userId: ctx.userId,
        topic: input.trim(),
        mode: "debate",
        rounds: 2,
      },
    });
    if (error) throw error;
    return { skillName: "debate", output: data?.verdict ?? data?.synthesis ?? data?.output ?? JSON.stringify(data) };
  } catch {
    // Fallback: structured dual-perspective LLM call
    const { data, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: input }],
        systemPrompt: `You are running a structured debate analysis. For the topic provided:

1. **PRO CASE** — Make the strongest possible argument FOR this position/option
2. **CON CASE** — Make the strongest possible argument AGAINST it
3. **KEY TENSIONS** — The 3 most important tradeoffs
4. **VERDICT** — Your balanced judgment with clear recommendation

Be rigorous on both sides. Don't let the verdict be wishy-washy — commit to a recommendation.`,
        mode: "SOVEREIGN",
        chatKind: "skill",
      },
    });
    if (chatErr) throw chatErr;
    return { skillName: "debate", output: data?.content ?? "[No output]" };
  }
};

registerSkill({
  name: "debate",
  description: "Runs opposing-perspective analysis on any decision or topic — pro/con cases, key tensions, and a clear verdict",
  keywords: [
    "debate", "argue both sides", "pros and cons", "devil's advocate",
    "should i", "is it better to", "evaluate this decision", "tradeoffs",
    "steelman the case", "analyze both options", "compare these options",
    "which is better", "build vs buy", "make the case for",
  ],
}, handler);
