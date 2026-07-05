// SKILL: deep-focus
// Deep work session planner and focus optimizer via mavis-chat.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "deep-focus", output: "Start a deep focus session. Example: 'deep focus: finish product spec doc 2 hours' or 'focus session: code review for 90 minutes' or 'deep work plan for today'" };
  }
  const task = input.replace(/^(deep focus|focus session|deep work plan for)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: task }],
        systemPrompt: "You are a deep work coach and productivity optimizer. Create a structured deep focus session plan: define the exact task, clear distraction plan, time blocks with specific deliverables, and an energy management strategy. Be precise and actionable.",
        mode: "PRIME",
        chatKind: "skill",
        user_id: ctx.userId,
      },
    });
    if (error) throw error;
    const result = data?.message ?? data?.output ?? data?.content;
    return { skillName: "deep-focus", output: result ? `🎯 **Deep Focus Session:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "deep-focus", output: `Deep focus error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "deep-focus",
  description: "Deep work session planner — time blocks, distraction protocol, deliverable milestones",
  keywords: [
    "deep focus", "focus session", "deep work", "focus mode",
    "deep work plan", "productivity session", "focus time block",
  ],
}, handler);
