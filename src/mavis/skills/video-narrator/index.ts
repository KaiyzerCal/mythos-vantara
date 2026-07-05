// SKILL: video-narrator
// Adds AI narration/voiceover to video content via mavis-video-narrator.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "video-narrator", output: "Give me a video URL or describe the content and I'll write or generate a narration script. Example: 'narrate this video: [url]'" };
  }
  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  const script = input.replace(/narrate\s+(?:this\s+)?(?:video\s+)?/i, "").replace(urlMatch?.[0] ?? "", "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-video-narrator", {
      body: { video_url: urlMatch?.[0] ?? null, script: script || null, narration_style: "professional" },
    });
    if (error) throw error;
    const result = data?.narration ?? data?.script ?? data?.audio_url ?? data?.output;
    return { skillName: "video-narrator", output: result ? `🎙️ **Narration:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "video-narrator", output: `Video narrator error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "video-narrator",
  description: "Writes or generates AI narration and voiceover scripts for videos",
  keywords: [
    "narrate this video", "add narration", "voiceover for", "narrate my video",
    "video narration", "add voiceover", "narration script", "commentary for video",
    "describe this video", "video commentary",
  ],
}, handler);
