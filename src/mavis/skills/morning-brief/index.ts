// SKILL: morning-brief
// Daily morning briefing — weather, calendar, tasks, news, and goals via mavis-morning-brief.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-morning-brief", {
      body: { user_id: ctx.userId, context: input?.trim() ?? "" },
    });
    if (error) throw error;
    const brief = data?.brief ?? data?.summary ?? data?.output;
    return { skillName: "morning-brief", output: brief ? `☀️ **Good Morning Brief:**\n\n${brief}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "morning-brief", output: `Morning brief error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "morning-brief",
  description: "Delivers a full morning briefing — schedule, tasks, news, weather, and goals",
  keywords: [
    "morning brief", "good morning", "start my day", "what's happening today",
    "morning summary", "daily brief", "today's plan", "what do i have today",
    "morning rundown", "day ahead", "morning update", "my day today",
  ],
}, handler);
