// SKILL: planner
// Creates structured project plans, roadmaps, and breakdowns via mavis-planner.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "planner", output: "Tell me what to plan. Example: 'make a plan for launching my app next month' or 'create a 90-day roadmap for my startup'" };
  }
  const goal = input.replace(/^(make|create|build|generate)\s+(a\s+)?(plan|roadmap|project plan|strategy)\s+(for|to|about)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-planner", {
      body: { goal, user_id: ctx.userId, format: "structured" },
    });
    if (error) throw error;
    const plan = data?.plan ?? data?.roadmap ?? data?.output ?? data?.result;
    return { skillName: "planner", output: plan ? `📋 **Plan: ${goal.slice(0, 60)}**\n\n${plan}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "planner", output: `Planner error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "planner",
  description: "Creates structured project plans, roadmaps, and step-by-step execution strategies",
  keywords: [
    "make a plan", "create a roadmap", "project plan", "execution plan",
    "plan this out", "build a roadmap", "90 day plan", "weekly plan",
    "launch plan", "strategic plan", "action plan", "project roadmap",
  ],
}, handler);
