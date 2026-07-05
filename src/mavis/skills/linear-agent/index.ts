// SKILL: linear-agent
// Manages Linear issues, projects, and roadmaps via mavis-linear-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "linear-agent", output: "Manage Linear. Example: 'linear: create issue fix login bug P1' or 'show my linear backlog'" };
  }
  const action = input.replace(/^(linear|linear agent|linear issue)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-linear-agent", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.issue ?? data?.issues ?? data?.result ?? data?.output;
    return { skillName: "linear-agent", output: result ? `📐 **Linear:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "linear-agent", output: `Linear error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "linear-agent",
  description: "Manages Linear issues, projects, cycles, and roadmaps",
  keywords: [
    "linear", "linear issue", "linear agent", "create issue", "linear backlog",
    "linear roadmap", "linear ticket", "linear project", "show linear",
  ],
}, handler);
