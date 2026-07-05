// SKILL: achievement-check
// Checks, unlocks, and lists VANTARA achievements via mavis-achievement-check.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-achievement-check", {
      body: { user_id: ctx.userId, query: input?.trim() ?? "all" },
    });
    if (error) throw error;
    const achievements = data?.achievements ?? data?.unlocked ?? data?.result ?? [];
    if (Array.isArray(achievements) && achievements.length > 0) {
      const list = achievements.slice(0, 10).map((a: any) =>
        `${a.unlocked ? "🏆" : "🔒"} **${a.name ?? a.title}** — ${a.description ?? ""}`
      ).join("\n");
      return { skillName: "achievement-check", output: `🏆 **Achievements:**\n${list}` };
    }
    return { skillName: "achievement-check", output: data?.output ?? "No achievements data available. Keep pushing!" };
  } catch (err) {
    return { skillName: "achievement-check", output: `Achievement check error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "achievement-check",
  description: "Shows earned and locked achievements in the VANTARA app",
  keywords: [
    "achievements", "my achievements", "what achievements", "unlocked achievements",
    "badges", "trophies", "what have i unlocked", "achievement progress",
    "locked achievements", "how close am i to", "achievement list",
  ],
}, handler);
