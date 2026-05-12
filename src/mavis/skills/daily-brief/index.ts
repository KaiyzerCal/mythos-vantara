import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase } from "@/integrations/supabase/client";

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;
    const [questsRes, tasksRes, energyRes] = await Promise.all([
      supabase.from("quests").select("id,title,status,type,deadline").eq("user_id", uid).eq("status", "active").order("deadline", { ascending: true }),
      supabase.from("tasks").select("id,title,status,recurrence,streak").eq("user_id", uid).eq("status", "active"),
      supabase.from("energy_systems").select("type,current_value,max_value,status").eq("user_id", uid),
    ]);

    const quests = questsRes.data ?? [];
    const tasks = tasksRes.data ?? [];
    const energy = energyRes.data ?? [];

    const overdueQuests = quests.filter((q: any) => q.deadline && new Date(q.deadline) < new Date());
    const activeQuests = quests.filter((q: any) => !q.deadline || new Date(q.deadline) >= new Date());
    const dailyTasks = tasks.filter((t: any) => t.recurrence === "daily");
    const lowEnergy = energy.filter((e: any) => (e.current_value / (e.max_value || 100)) < 0.4);

    const lines: string[] = ["DAILY BRIEF — CODEXOS STATUS REPORT\n"];

    lines.push(`ACTIVE QUESTS (${activeQuests.length}):`);
    if (activeQuests.length === 0) lines.push("  None active.");
    else activeQuests.slice(0, 5).forEach((q: any) => lines.push(`  • ${q.title}${q.deadline ? ` — due ${new Date(q.deadline).toLocaleDateString()}` : ""}`));

    if (overdueQuests.length > 0) {
      lines.push(`\nOVERDUE (${overdueQuests.length}) — REQUIRES ATTENTION:`);
      overdueQuests.forEach((q: any) => lines.push(`  ⚠ ${q.title} — overdue since ${new Date(q.deadline).toLocaleDateString()}`));
    }

    lines.push(`\nDAILY HABITS (${dailyTasks.length}):`);
    if (dailyTasks.length === 0) lines.push("  No daily habits configured.");
    else dailyTasks.slice(0, 5).forEach((t: any) => lines.push(`  • ${t.title} | streak: ${t.streak ?? 0}`));

    lines.push(`\nENERGY SYSTEMS:`);
    if (energy.length === 0) lines.push("  No energy systems tracked.");
    else energy.forEach((e: any) => lines.push(`  • ${e.type}: ${e.current_value}/${e.max_value} [${e.status}]`));

    if (lowEnergy.length > 0) {
      lines.push(`\nLOW ENERGY WARNING: ${lowEnergy.map((e: any) => e.type).join(", ")} — recommend lighter workload today.`);
    }

    return { skillName: "daily-brief", output: lines.join("\n") };
  } catch (err) {
    return { skillName: "daily-brief", output: `Brief unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "daily-brief",
  description: "Generates a daily status brief — active quests, habits, energy levels, and overdue items",
  keywords: ["brief me", "daily brief", "morning brief", "status report", "what's on today", "what do i have today", "overview"],
}, handler);
