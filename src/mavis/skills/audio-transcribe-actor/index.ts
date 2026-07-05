// SKILL: audio-transcribe-actor
// Transcribes audio files from URL via Apify parseforge/audio-transcriber.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "audio-transcribe-actor", output: "Transcribe audio from URL. Example: 'transcribe audio https://example.com/podcast.mp3' or 'audio transcription: https://storage.example.com/recording.wav'" };
  }
  const audioUrl = input.match(/https?:\/\/[^\s]+/)?.[0] ?? input.replace(/^(transcribe audio|audio transcription)\s*:?\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "parseforge/audio-transcriber", input: { audioUrl }, timeout: 180 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.transcript ?? data;
    return { skillName: "audio-transcribe-actor", output: result ? `🎤 **Audio Transcript:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 6000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "audio-transcribe-actor", output: `Audio transcribe error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "audio-transcribe-actor",
  description: "Transcribes audio files from a URL — podcasts, recordings, voice memos",
  keywords: [
    "transcribe audio", "audio transcription", "transcribe podcast", "audio to text",
    "transcribe recording", "audio transcriber", "speech to text url",
  ],
}, handler);
