// SKILL: screenpipe
// Captures and queries screen activity and app usage via mavis-screenpipe.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "screenpipe", output: "Query your screen activity. Example: 'screenpipe: what was I working on this morning?' or 'show my app usage today'" };
  }
  const query = input.replace(/^(screenpipe|screen pipe|screen activity|app usage)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-screenpipe", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.activity ?? data?.results ?? data?.output;
    return { skillName: "screenpipe", output: result ? `🖥️ **Screenpipe:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "screenpipe", output: `Screenpipe error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "screenpipe",
  description: "Captures and queries screen activity, app usage, and what you worked on throughout the day",
  keywords: [
    "screenpipe", "screen activity", "what was i doing", "app usage", "screen history",
    "what i worked on", "screen capture", "activity log", "screen query",
  ],
}, handler);
