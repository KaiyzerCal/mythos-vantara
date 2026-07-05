// SKILL: tts
// Converts text to natural-sounding speech via mavis-tts.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "tts", output: "Convert text to speech. Example: 'tts: Welcome to Vantara, your AI operating system' or 'read this aloud: [text]'" };
  }
  const text = input.replace(/^(tts|text to speech|read aloud|speak|narrate)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-tts", {
      body: { text: text.slice(0, 4096), voice: "alloy" },
    });
    if (error) throw error;
    const result = data?.audio_url ?? data?.url ?? data?.output;
    return { skillName: "tts", output: result ? `🔊 **Text-to-Speech:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "tts", output: `TTS error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "tts",
  description: "Converts text to natural-sounding speech audio",
  keywords: [
    "text to speech", "tts", "read aloud", "speak this", "narrate",
    "convert to audio", "text to audio", "voice over", "make audio",
  ],
}, handler);
