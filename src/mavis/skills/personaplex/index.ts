// SKILL: personaplex
// NVIDIA PersonaPlex-7B persona voice synthesis with MAVIS-specific presets via mavis-personaplex.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "personaplex", output: "Synthesize a persona voice. Example: 'personaplex: speak as the stoic advisor about market volatility' or 'personaplex nora: [message]'" };
  }
  const personaMatch = input.match(/personaplex\s+(\w+)\s*:/i);
  const persona = personaMatch?.[1] ?? "prime";
  const text = input.replace(/^(personaplex)\s*(\w+)?\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-personaplex", {
      body: { text, persona, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.audio_url ?? data?.response ?? data?.output;
    return { skillName: "personaplex", output: result ? `🎙️ **PersonaPlex:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "personaplex", output: `Personaplex error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "personaplex",
  description: "NVIDIA PersonaPlex-7B persona voice synthesis — 170ms TTFA, MAVIS-specific voice presets per mode",
  keywords: [
    "personaplex", "persona voice", "persona synthesis", "nvidia personaplex",
    "speak as persona", "voice persona", "personaplex nora",
  ],
}, handler);
