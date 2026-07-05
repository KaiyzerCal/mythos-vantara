// SKILL: pipeline-run
// Runs a multi-agent pipeline: Researcher → Strategist → Writer → Editor via mavis-chat.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "pipeline-run", output: "Run a full pipeline. Example: 'pipeline: write a thought leadership article on AI in healthcare' or 'full pipeline: launch strategy for my new product'" };
  }
  const brief = input.replace(/^(pipeline|run pipeline|full pipeline)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: brief }],
        systemPrompt: "You are a multi-agent pipeline orchestrator. Execute a full Researcher → Strategist → Writer → Editor pipeline for the given brief. Label each phase clearly. Researcher: gather relevant context and facts. Strategist: define angle and structure. Writer: produce the draft. Editor: refine for clarity, voice, and impact. Output the final polished deliverable.",
        mode: "PRIME",
        chatKind: "skill",
        user_id: ctx.userId,
      },
    });
    if (error) throw error;
    const result = data?.message ?? data?.output ?? data?.content;
    return { skillName: "pipeline-run", output: result ? `🔄 **Pipeline Output:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 6000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "pipeline-run", output: `Pipeline error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "pipeline-run",
  description: "Runs full Researcher → Strategist → Writer → Editor pipeline on any brief",
  keywords: [
    "pipeline run", "run pipeline", "full pipeline", "agent pipeline",
    "research write edit", "pipeline deliverable", "multi-agent pipeline",
  ],
}, handler);
