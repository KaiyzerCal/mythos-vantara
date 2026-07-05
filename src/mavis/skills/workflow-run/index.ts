// SKILL: workflow-run
// Triggers and runs predefined MAVIS workflows via mavis-workflow-run.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "workflow-run", output: "Run a workflow. Example: 'run workflow: weekly review' or 'trigger my content pipeline'" };
  }
  const workflowName = input.replace(/^(run workflow|trigger workflow|execute workflow|run)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-workflow-run", {
      body: { workflow: workflowName, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.result ?? data?.status ?? data?.output;
    return { skillName: "workflow-run", output: result ? `⚡ **Workflow Run:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "workflow-run", output: `Workflow run error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "workflow-run",
  description: "Triggers and runs predefined MAVIS workflows and automation pipelines",
  keywords: [
    "run workflow", "trigger workflow", "execute workflow", "start workflow",
    "workflow run", "run pipeline", "trigger pipeline", "execute automation",
  ],
}, handler);
