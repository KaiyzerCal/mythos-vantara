// SKILL: profile-update
// Synthesizes a rich user profile (style, preferences, context) via mavis-profile-updater.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "profile-update", output: "Update your MAVIS profile. Example: 'update profile' or 'update my preferences: I prefer concise responses and bullet points'" };
  }
  const notes = input.replace(/^(update profile|profile update|update my preferences|update preferences)\s*:?\s*/i, "").trim() || "refresh from recent interactions";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-profile-updater", {
      body: { notes, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.profile ?? data?.status ?? data?.output;
    return { skillName: "profile-update", output: result ? `✏️ **Profile Updated:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "profile-update", output: `Profile update error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "profile-update",
  description: "Synthesizes and updates your MAVIS profile — communication style, standing context, preferences",
  keywords: [
    "profile update", "update profile", "update my preferences", "update preferences",
    "update my context", "refresh profile", "update my style",
  ],
}, handler);
