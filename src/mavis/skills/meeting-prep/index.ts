// SKILL: meeting-prep
// Prepares research and talking points for upcoming meetings via mavis-meeting-prep.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "meeting-prep", output: "Prep for a meeting. Example: 'prep for meeting with John Smith from Stripe' or 'meeting prep: investor call tomorrow'" };
  }
  const details = input.replace(/^(meeting prep|prep for meeting|prepare for)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-meeting-prep", {
      body: { meeting_details: details, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.prep ?? data?.briefing ?? data?.talking_points ?? data?.output;
    return { skillName: "meeting-prep", output: result ? `📋 **Meeting Prep:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "meeting-prep", output: `Meeting prep error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "meeting-prep",
  description: "Prepares research, talking points, and background for upcoming meetings",
  keywords: [
    "meeting prep", "prepare for meeting", "pre-meeting research", "meeting briefing",
    "talking points", "prep for call", "prepare meeting", "meeting research",
  ],
}, handler);
