// SKILL: voice-session
// Manages persistent voice sessions with context memory via mavis-voice-session.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const action = /stop|end|pause/i.test(input ?? "") ? "end" : /resume/i.test(input ?? "") ? "resume" : "start";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-voice-session", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.session ?? data?.status ?? data?.output;
    return { skillName: "voice-session", output: result ? `🔊 **Voice Session:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "voice-session", output: `Voice session error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "voice-session",
  description: "Manages persistent voice sessions with MAVIS — start, pause, resume, end",
  keywords: [
    "voice session", "start voice", "end voice session", "resume voice",
    "persistent voice", "voice with memory", "voice context",
  ],
}, handler);
