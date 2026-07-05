// SKILL: crew-orchestrate
// Runs an AI swarm: planner decomposes → specialists run parallel → synthesizer integrates via mavis-crew-orchestrator.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "crew-orchestrate", output: "Run an AI crew on a complex task. Example: 'crew: analyze my competitors and write a positioning strategy' or 'orchestrate: build a go-to-market plan for my SaaS'" };
  }
  const goal = input.replace(/^(crew|crew orchestrate|orchestrate|ai crew|ai swarm)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-crew-orchestrator", {
      body: { goal, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.synthesis ?? data?.result ?? data?.output;
    return { skillName: "crew-orchestrate", output: result ? `🤝 **Crew Synthesis:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "crew-orchestrate", output: `Crew orchestrate error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "crew-orchestrate",
  description: "Deploys an AI crew swarm — planner decomposes goal, specialists work in parallel, synthesizer integrates results",
  keywords: [
    "crew orchestrate", "ai crew", "ai swarm", "orchestrate team", "multi-agent",
    "crew run", "deploy crew", "parallel agents", "agent swarm", "coordinate agents",
  ],
}, handler);
