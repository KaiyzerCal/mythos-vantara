// SKILL: spotify-sync
// Syncs Spotify listening history and mood data into MAVIS memory via mavis-spotify-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-spotify-sync", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.synced ?? data?.tracks ?? data?.output;
    return { skillName: "spotify-sync", output: result ? `🎧 **Spotify Sync:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "spotify-sync", output: `Spotify sync error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "spotify-sync",
  description: "Syncs Spotify listening history and mood signals into MAVIS memory for personalization",
  keywords: [
    "spotify sync", "sync spotify", "spotify history", "music taste sync",
    "spotify to memory", "sync listening history", "spotify mood sync",
  ],
}, handler);
