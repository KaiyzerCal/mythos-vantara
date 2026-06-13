import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;
    const { data: quests } = await supabase
      .from("quests")
      .select("*")
      .eq("user_id", uid)
      .order("updated_at", { ascending: false });

    if (!quests || quests.length === 0) {
      return { skillName: "quest-review", output: "No quests found. Time to create some." };
    }

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const active = quests.filter((q: any) => q.status === "active");
    const completed = quests.filter((q: any) => q.status === "completed");
    const failed = quests.filter((q: any) => q.status === "failed");
    const idle = active.filter((q: any) => {
      const updated = new Date(q.updated_at).getTime();
      return now - updated > sevenDaysMs;
    });

    const lines: string[] = ["QUEST REVIEW — FULL MISSION ASSESSMENT\n"];
    lines.push(`TOTALS: ${active.length} active | ${completed.length} completed | ${failed.length} failed\n`);

    if (idle.length > 0) {
      lines.push(`IDLE QUESTS (no activity 7+ days) — REVIEW THESE:`);
      idle.forEach((q: any) => {
        const daysSince = Math.floor((now - new Date(q.updated_at).getTime()) / (24 * 60 * 60 * 1000));
        lines.push(`  ⚠ [${q.id.slice(0, 8)}] "${q.title}" — idle ${daysSince} days | ${q.difficulty} | ${q.xp_reward} XP`);
      });
      lines.push("");
    }

    lines.push(`ACTIVE QUESTS:`);
    active.forEach((q: any) => {
      const progress = q.progress_target > 0 ? ` (${q.progress_current}/${q.progress_target})` : "";
      const deadline = q.deadline ? ` | due ${new Date(q.deadline).toLocaleDateString()}` : "";
      lines.push(`  • [${q.id.slice(0, 8)}] "${q.title}" | ${q.type} | ${q.difficulty}${progress}${deadline}`);
    });

    if (completed.length > 0) {
      lines.push(`\nRECENT COMPLETIONS (last 5):`);
      completed.slice(0, 5).forEach((q: any) => lines.push(`  ✓ "${q.title}" | +${q.xp_reward} XP`));
    }

    return { skillName: "quest-review", output: lines.join("\n") };
  } catch (err) {
    return { skillName: "quest-review", output: `Quest review failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "quest-review",
  description: "Full review of all quests — surfaces idle quests, progress, and completion stats",
  keywords: ["quest review", "review quests", "check quests", "idle quests", "quest status", "mission review"],
}, handler);
