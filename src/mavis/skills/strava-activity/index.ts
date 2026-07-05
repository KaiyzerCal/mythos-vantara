// SKILL: strava-activity
// Fetches Strava workouts, runs, and fitness stats via mavis-strava-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-strava-sync", {
      body: { action: "recent_activities", user_id: ctx.userId, limit: 5 },
    });
    if (error) throw error;
    const activities = data?.activities ?? data?.results ?? [];
    if (Array.isArray(activities) && activities.length > 0) {
      const list = activities.map((a: any) =>
        `• **${a.name ?? a.type}** — ${a.distance ? `${(a.distance / 1000).toFixed(1)}km` : ""} ${a.elapsed_time ? `· ${Math.round(a.elapsed_time / 60)}min` : ""} ${a.start_date ? `· ${new Date(a.start_date).toLocaleDateString()}` : ""}`
      ).join("\n");
      return { skillName: "strava-activity", output: `🏃 **Recent Strava Activities:**\n${list}` };
    }
    return { skillName: "strava-activity", output: data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "strava-activity", output: `Strava error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "strava-activity",
  description: "Fetches recent Strava workouts, runs, rides, and fitness performance stats",
  keywords: [
    "strava", "my strava", "recent workouts", "strava runs", "run data",
    "strava activity", "workout history", "running stats", "fitness activity",
    "last run", "strava stats", "cycling data",
  ],
}, handler);
