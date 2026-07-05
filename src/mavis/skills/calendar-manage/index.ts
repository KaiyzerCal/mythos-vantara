// SKILL: calendar-manage
// Creates events, checks schedule, and manages calendar via mavis-calendar-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "calendar-manage", output: "Tell me what to schedule. Example: 'schedule a call with Alex tomorrow at 3pm' or 'what's on my calendar this week?'" };
  }
  const action = /what.?s on|show|check|list|upcoming|today|this week/i.test(input) ? "list" : "create";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-calendar-agent", {
      body: { action, query: input.trim(), user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.events ?? data?.event ?? data?.result ?? data?.output;
    return {
      skillName: "calendar-manage",
      output: result
        ? (Array.isArray(result) ? `📅 **Your Schedule:**\n${result.map((e: any) => `• ${e.summary ?? e.title} — ${e.start ?? e.time}`).join("\n")}` : String(result))
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "calendar-manage", output: `Calendar error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "calendar-manage",
  description: "Schedules events, checks your calendar, and manages meetings",
  keywords: [
    "schedule", "add to calendar", "what's on my calendar", "book a meeting",
    "create an event", "upcoming events", "today's schedule", "this week's calendar",
    "block time", "reschedule", "cancel event", "check my schedule",
  ],
}, handler);
