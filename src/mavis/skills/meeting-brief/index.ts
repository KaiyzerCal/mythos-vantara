// SKILL: meeting-brief
// Calls mavis-meeting-notes to extract structured notes + action items from a transcript.
// Pattern adapted from 500-AI-Agents-Projects #10 (meeting notes agent).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return {
      skillName: "meeting-brief",
      output: "Paste your meeting transcript or notes after the command and I'll extract action items, decisions, and a summary.",
    };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-meeting-notes", {
      body: { transcript: input.trim() },
    });
    if (error) throw error;
    const output = data?.notes ?? data?.summary ?? data?.output ?? JSON.stringify(data);
    return { skillName: "meeting-brief", output };
  } catch (err) {
    return {
      skillName: "meeting-brief",
      output: `Meeting notes extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill({
  name: "meeting-brief",
  description: "Extracts structured notes, action items, decisions, and a summary from a meeting transcript",
  keywords: [
    "meeting notes", "meeting summary", "summarize meeting", "action items",
    "meeting recap", "take notes", "extract notes", "meeting transcript",
    "what was decided", "decisions from", "debrief meeting",
  ],
}, handler);
