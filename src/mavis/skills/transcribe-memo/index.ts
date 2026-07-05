// SKILL: transcribe-memo
// Transcribes voice memos and audio notes via mavis-transcribe-memo.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "transcribe-memo", output: "Transcribe a voice memo. Example: 'transcribe memo [url]' or 'transcribe my voice note'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-transcribe-memo", {
      body: { audio_url: url, user_id: ctx.userId, save_to_notes: true },
    });
    if (error) throw error;
    const result = data?.transcript ?? data?.text ?? data?.output;
    return { skillName: "transcribe-memo", output: result ? `🎤 **Transcription:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "transcribe-memo", output: `Transcribe memo error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "transcribe-memo",
  description: "Transcribes voice memos and audio notes, saving them to your knowledge base",
  keywords: [
    "transcribe memo", "voice memo", "transcribe audio", "voice note",
    "audio note", "speech to text", "memo transcription", "transcribe my note",
  ],
}, handler);
