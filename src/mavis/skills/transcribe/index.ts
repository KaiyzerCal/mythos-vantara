// SKILL: transcribe
// Transcribes audio/video to text via mavis-transcribe.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "transcribe", output: "Give me a media URL or describe what you want transcribed. I support audio files, video URLs, and voice memos." };
  }
  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  try {
    const { data, error } = await supabase.functions.invoke("mavis-transcribe", {
      body: { url: urlMatch?.[0] ?? null, prompt: input.trim() },
    });
    if (error) throw error;
    const transcript = data?.transcript ?? data?.text ?? data?.output;
    return { skillName: "transcribe", output: transcript ? `**Transcript:**\n\n${transcript}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "transcribe", output: `Transcription failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "transcribe",
  description: "Transcribes audio or video to text using AI speech recognition",
  keywords: [
    "transcribe", "transcribe this", "voice to text", "speech to text",
    "convert audio to text", "transcribe audio", "transcribe video",
    "turn this into text", "get the words from", "extract audio",
  ],
}, handler);
