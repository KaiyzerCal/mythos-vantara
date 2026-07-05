// SKILL: calendar-sync
// Parses iCal URLs and syncs events to the calendar_events table via mavis-calendar-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "calendar-sync", output: "Sync a calendar. Example: 'calendar sync: https://calendar.google.com/...ical' or 'sync my ical feed'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-calendar-sync", {
      body: { ical_url: url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.synced ?? data?.events ?? data?.output;
    return { skillName: "calendar-sync", output: result ? `📅 **Calendar Synced:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "calendar-sync", output: `Calendar sync error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "calendar-sync",
  description: "Parses iCal/ICS feed URLs and syncs events into Vantara's calendar table",
  keywords: [
    "calendar sync", "sync calendar", "ical sync", "ics feed", "import calendar",
    "calendar feed", "sync ical", "calendar import",
  ],
}, handler);
