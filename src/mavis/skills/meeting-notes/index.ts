// SKILL: meeting-notes
// Generates structured meeting notes and action items via mavis-meeting-notes.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "meeting-notes", output: "Generate meeting notes. Example: 'meeting notes: we discussed Q3 roadmap and decided to delay launch...' or 'take notes on this meeting transcript'" };
  }
  const content = input.replace(/^(meeting notes|take notes|notes from)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-meeting-notes", {
      body: { content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.notes ?? data?.action_items ?? data?.output;
    return { skillName: "meeting-notes", output: result ? `📝 **Meeting Notes:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "meeting-notes", output: `Meeting notes error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "meeting-notes",
  description: "Generates structured meeting notes with summaries and action items from transcripts or descriptions",
  keywords: [
    "meeting notes", "take notes", "notes from meeting", "meeting summary",
    "action items", "meeting recap", "capture meeting", "document meeting",
  ],
}, handler);
