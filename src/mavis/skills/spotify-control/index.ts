// SKILL: spotify-control
// Controls Spotify playback and searches music via mavis-spotify-control.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "spotify-control", output: "Control your Spotify. Try: 'play lo-fi hip hop', 'pause music', 'skip this song', 'volume up', or 'play Drake'" };
  }
  const lower = input.toLowerCase();
  const action = lower.includes("pause") || lower.includes("stop") ? "pause"
    : lower.includes("skip") || lower.includes("next") ? "next"
    : lower.includes("previous") || lower.includes("back") ? "previous"
    : lower.includes("volume up") ? "volume_up"
    : lower.includes("volume down") ? "volume_down"
    : "play";
  const query = input.replace(/^(play|put on|queue|add)\s+/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-spotify-control", {
      body: { action, query: action === "play" ? query : undefined, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.message ?? data?.result ?? data?.now_playing ?? data?.output;
    return { skillName: "spotify-control", output: result ? `🎵 ${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "spotify-control", output: `Spotify error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "spotify-control",
  description: "Controls Spotify — play, pause, skip, search, and queue songs or playlists",
  keywords: [
    "play music", "play on spotify", "pause music", "skip song", "next track",
    "queue this", "play playlist", "volume up", "volume down", "play some",
    "spotify", "put on", "play something", "music on", "shuffle play",
  ],
}, handler);
