// SKILL: heygen-simple
// Quick HeyGen video via mavis-heygen-agent, using the operator's saved
// default avatar/voice (set in Avatar Studio) when not given explicitly.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "heygen-simple", output: "Quick HeyGen video. Example: 'heygen quick: [script]' or 'list heygen avatars' or 'heygen status: [video_id]'" };
  }
  const action = /list avatar|avatars/i.test(input) ? "list_avatars"
    : /status|check/i.test(input) ? "get_video_status"
    : "generate_video";
  const content = input.replace(/^(heygen quick|heygen simple|heygen status|list heygen avatars|heygen)\s*:?\s*/i, "").trim() || input;

  try {
    const payload: Record<string, unknown> = { userId: ctx.userId, action };
    if (action === "get_video_status") {
      payload.video_id = content;
    } else if (action === "generate_video") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("default_heygen_avatar_id, default_heygen_voice_id")
        .eq("id", ctx.userId)
        .single();
      if (!profile?.default_heygen_avatar_id || !profile?.default_heygen_voice_id) {
        return { skillName: "heygen-simple", output: "No default HeyGen avatar/voice set — configure one in Avatar Studio first." };
      }
      payload.avatar_id = profile.default_heygen_avatar_id;
      payload.voice_id = profile.default_heygen_voice_id;
      payload.text = content;
    }

    const { data, error } = await supabase.functions.invoke("mavis-heygen-agent", { body: payload });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    const result = data?.video_url ?? data?.avatars ?? data?.status ?? data?.output;
    return { skillName: "heygen-simple", output: result ? `🎬 **HeyGen:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "heygen-simple", output: `HeyGen error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "heygen-simple",
  description: "Direct HeyGen v2 API — create quick avatar videos with the operator's default avatar, list available avatars, check video status",
  keywords: [
    "heygen quick", "heygen simple", "heygen status", "list heygen avatars",
    "heygen create", "quick avatar video",
  ],
}, handler);
