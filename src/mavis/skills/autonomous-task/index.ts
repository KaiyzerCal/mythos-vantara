// SKILL: autonomous-task
// Runs multi-step autonomous tasks end-to-end via mavis-autonomous-runner.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "autonomous-task", output: "Run an autonomous task. Example: 'autonomously research and write a report on AI trends' or 'auto: find 10 leads in fintech and draft outreach'" };
  }
  const task = input.replace(/^(autonomous task|auto task|autonomously|auto)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-autonomous-runner", {
      body: { task, user_id: ctx.userId, max_steps: 10 },
    });
    if (error) throw error;
    const result = data?.result ?? data?.output ?? data?.steps;
    return { skillName: "autonomous-task", output: result ? `🤖 **Autonomous Task:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "autonomous-task", output: `Autonomous task error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "autonomous-task",
  description: "Runs complex multi-step tasks autonomously — research, outreach, analysis pipelines",
  keywords: [
    "autonomous task", "auto task", "autonomously", "run this for me",
    "do this automatically", "multi-step task", "agentic task", "auto run",
    "autonomous agent", "execute this task",
  ],
}, handler);
