import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;
    const today = new Date().toISOString().slice(0, 10);

    const { data: dailyTasks } = await supabase
      .from("tasks")
      .select("id, title, streak, current_streak")
      .eq("user_id", uid)
      .eq("recurrence", "daily")
      .eq("status", "active");

    if (!dailyTasks || dailyTasks.length === 0) {
      return { skillName: "habit-check", output: "No daily habits configured. Add recurring tasks to start tracking habits." };
    }

    const taskIds = dailyTasks.map((t: any) => t.id);
    const { data: completions } = await supabase
      .from("task_completions")
      .select("task_id")
      .in("task_id", taskIds)
      .gte("completed_at", today);

    const doneIds = new Set((completions ?? []).map((c: any) => c.task_id));
    const done = dailyTasks.filter((t: any) => doneIds.has(t.id));
    const pending = dailyTasks.filter((t: any) => !doneIds.has(t.id));
    const rate = Math.round((done.length / dailyTasks.length) * 100);

    const lines: string[] = [`HABIT CHECK — ${today}\n`];
    lines.push(`COMPLETION: ${done.length}/${dailyTasks.length} (${rate}%)\n`);

    if (done.length > 0) {
      lines.push("DONE:");
      done.forEach((t: any) => lines.push(`  ✓ ${t.title} | streak: ${t.current_streak ?? t.streak ?? 0}d`));
    }

    if (pending.length > 0) {
      lines.push(`\nPENDING (${pending.length}):`);
      pending.forEach((t: any) => lines.push(`  ○ ${t.title} | streak: ${t.current_streak ?? t.streak ?? 0}d`));
    }

    if (rate === 100) lines.push("\nPERFECT DAY — all habits complete.");
    else if (rate >= 60) lines.push(`\nSolid progress. ${pending.length} habit${pending.length > 1 ? "s" : ""} remaining.`);
    else lines.push(`\nBehind pace. Focus on clearing the pending list.`);

    return { skillName: "habit-check", output: lines.join("\n") };
  } catch (err) {
    return { skillName: "habit-check", output: `Habit check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "habit-check",
  description: "Shows today's habit completion status — which daily habits are done and which are pending",
  keywords: ["habit check", "habits today", "what habits", "daily habits", "check habits", "habit status", "done today", "completed today"],
}, handler);
