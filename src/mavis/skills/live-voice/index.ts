// SKILL: live-voice
// Starts a live voice session with MAVIS via mavis-live-voice.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const action = /stop|end|close/i.test(input ?? "") ? "stop" : "start";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-live-voice", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.session ?? data?.status ?? data?.output;
    return { skillName: "live-voice", output: result ? `🎙️ **Live Voice:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "live-voice", output: `Live voice error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "live-voice",
  description: "Starts or stops a live voice session with MAVIS using real-time audio",
  keywords: [
    "live voice", "start voice session", "voice chat", "talk to mavis",
    "real-time voice", "voice mode", "speak to mavis",
  ],
}, handler);
