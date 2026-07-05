// SKILL: heygen-simple
// Simple HeyGen v2 API: create video, poll status, list avatars via mavis-heygen.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "heygen-simple", output: "Quick HeyGen video. Example: 'heygen quick: [script]' or 'list heygen avatars' or 'heygen status: [video_id]'" };
  }
  const action = /list avatar|avatars/i.test(input) ? "list_avatars"
    : /status|check/i.test(input) ? "status"
    : "create";
  const content = input.replace(/^(heygen quick|heygen simple|heygen status|list heygen avatars|heygen)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-heygen", {
      body: { action, content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.video_url ?? data?.avatars ?? data?.status ?? data?.output;
    return { skillName: "heygen-simple", output: result ? `🎬 **HeyGen:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "heygen-simple", output: `HeyGen error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "heygen-simple",
  description: "Direct HeyGen v2 API — create quick avatar videos, list available avatars, check video status",
  keywords: [
    "heygen quick", "heygen simple", "heygen status", "list heygen avatars",
    "heygen create", "quick avatar video",
  ],
}, handler);
