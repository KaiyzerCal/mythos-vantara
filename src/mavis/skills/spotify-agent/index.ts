// SKILL: spotify-agent
// Spotify playback control and search via mavis-spotify-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "spotify-agent", output: "Control Spotify. Example: 'play focus music on spotify' or 'spotify search lofi beats' or 'pause spotify'" };
  }
  const query = input.replace(/^(spotify|play|pause|search spotify)\s*/i, "").trim() || input;
  const action = /pause|stop/i.test(input) ? "pause" : /next|skip/i.test(input) ? "next" : /search/i.test(input) ? "search" : "play";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-spotify-agent", {
      body: { action, query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.result ?? data?.track ?? data?.output;
    return { skillName: "spotify-agent", output: result ? `🎵 **Spotify:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "spotify-agent", output: `Spotify agent error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "spotify-agent",
  description: "Spotify playback control — play, pause, skip, search tracks and playlists",
  keywords: [
    "spotify", "play music", "pause spotify", "spotify search", "play on spotify",
    "skip track", "next song", "spotify control",
  ],
}, handler);
