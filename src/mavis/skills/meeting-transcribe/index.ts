// SKILL: meeting-transcribe
// Transcribes and summarizes meetings with action items via mavis-meeting-transcribe.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "meeting-transcribe", output: "Give me a meeting recording URL or audio file and I'll transcribe and extract action items. Example: 'transcribe meeting: [url]'" };
  }
  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  try {
    const { data, error } = await supabase.functions.invoke("mavis-meeting-transcribe", {
      body: { url: urlMatch?.[0] ?? null, prompt: input.trim(), extract_action_items: true },
    });
    if (error) throw error;
    const transcript = data?.transcript ?? data?.text;
    const summary = data?.summary;
    const actions = data?.action_items ?? data?.actions;
    const parts: string[] = [];
    if (summary) parts.push(`**Summary:** ${summary}`);
    if (actions?.length) parts.push(`**Action Items:**\n${(Array.isArray(actions) ? actions : [actions]).map((a: string) => `• ${a}`).join("\n")}`);
    if (transcript) parts.push(`**Transcript:**\n${String(transcript).slice(0, 3000)}`);
    return { skillName: "meeting-transcribe", output: parts.length ? parts.join("\n\n") : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "meeting-transcribe", output: `Meeting transcription failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "meeting-transcribe",
  description: "Transcribes meeting recordings and extracts summaries, decisions, and action items",
  keywords: [
    "transcribe meeting", "meeting notes from", "meeting recording",
    "meeting summary", "action items from meeting", "zoom recording",
    "call transcript", "meeting transcript", "summarize meeting",
  ],
}, handler);
