// SKILL: goal-engine
// Creates, updates, and tracks goals and quests in the vantara.exe app via mavis-goal-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "goal-engine", output: "Manage your goals. Example: 'add goal: launch my app by August' or 'show my active goals' or 'what progress have I made on my goals?'" };
  }
  const action = /show|list|check|my goals|progress|status/i.test(input) ? "list"
    : /add|create|new goal|set a goal/i.test(input) ? "create"
    : /complete|done|finished|achieved/i.test(input) ? "complete"
    : /update|progress|worked on/i.test(input) ? "update"
    : "list";
  const goalText = input.replace(/^(add|create|new|set a?)\s+(goal|quest|objective)\s*:?\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-goal-agent", {
      body: { action, goal: goalText, user_id: ctx.userId },
    });
    if (error) throw error;
    const goals = data?.goals ?? data?.goal ?? data?.result ?? data?.output;
    if (action === "list" && Array.isArray(goals)) {
      const list = goals.slice(0, 10).map((g: any) =>
        `• **${g.title ?? g.name}** — ${g.status ?? "active"} ${g.progress != null ? `(${g.progress}%)` : ""}`
      ).join("\n");
      return { skillName: "goal-engine", output: `🎯 **Your Goals:**\n${list}` };
    }
    return {
      skillName: "goal-engine",
      output: goals
        ? (action === "create" ? `🎯 Goal set: "${goalText}"` : String(goals))
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "goal-engine", output: `Goal engine error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "goal-engine",
  description: "Creates, tracks, and updates goals and quests inside the VANTARA app",
  keywords: [
    "my goals", "add goal", "new goal", "create goal", "set a goal",
    "goal progress", "track goal", "achieve goal", "goal status",
    "what are my goals", "show goals", "quest objective",
  ],
}, handler);
