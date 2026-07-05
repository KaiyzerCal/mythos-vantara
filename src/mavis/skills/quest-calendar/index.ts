// SKILL: quest-calendar
// Pushes active quest deadlines to Google Calendar as events via mavis-quest-calendar.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-quest-calendar", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.synced ?? data?.events ?? data?.output;
    return { skillName: "quest-calendar", output: result ? `📅 **Quest Calendar Synced:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "quest-calendar", output: `Quest calendar error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "quest-calendar",
  description: "Syncs active quest deadlines to Google Calendar as events",
  keywords: [
    "quest calendar", "sync quests to calendar", "quests to google calendar",
    "quest events", "calendar quest sync", "add quests to calendar",
  ],
}, handler);
