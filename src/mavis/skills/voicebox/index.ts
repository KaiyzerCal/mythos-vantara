// SKILL: voicebox
// Generates custom voice clones and high-quality speech via mavis-voicebox.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "voicebox", output: "Generate custom voice audio. Example: 'voicebox: say this in a deep professional voice [text]' or 'clone voice and say [text]'" };
  }
  const text = input.replace(/^(voicebox|voice box|custom voice|clone voice|voice gen)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-voicebox", {
      body: { text: text.slice(0, 4096), user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.audio_url ?? data?.url ?? data?.output;
    return { skillName: "voicebox", output: result ? `🎙️ **Voicebox:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "voicebox", output: `Voicebox error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "voicebox",
  description: "Generates high-quality custom voice audio with selectable or cloned voice styles",
  keywords: [
    "voicebox", "custom voice", "voice clone", "voice generation", "clone voice",
    "generate voice", "ai voice", "voice synthesis", "voice box",
  ],
}, handler);
