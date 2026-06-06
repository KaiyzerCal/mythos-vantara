import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;
    const today = new Date();

    const [questsRes, journalRes, energyRes, alliesRes, memoriesRes] = await Promise.all([
      supabase
        .from("quests")
        .select("id,title,status,type,deadline,progress_current,progress_target,xp_reward,description")
        .eq("user_id", uid),
      supabase
        .from("journal_entries")
        .select("title,category,created_at,importance,mood")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("energy_systems")
        .select("type,current_value,max_value,status")
        .eq("user_id", uid),
      supabase
        .from("allies")
        .select("name,relationship,affinity,level,notes")
        .eq("user_id", uid),
      supabase
        .from("memories")
        .select("title,content,created_at")
        .eq("user_id", uid)
        .in("source", ["mavis_chat_clear", "mavis_auto_memory"])
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const allQuests: any[] = questsRes.data ?? [];
    const journal: any[] = journalRes.data ?? [];
    const energy: any[] = energyRes.data ?? [];
    const allies: any[] = alliesRes.data ?? [];
    const memories: any[] = memoriesRes.data ?? [];

    const activeQuests = allQuests.filter((q: any) => q.status === "active");
    const completedQuests = allQuests.filter((q: any) => q.status === "completed");

    const staleQuests = activeQuests.filter((q: any) => q.deadline && new Date(q.deadline) < today);
    const onTrackQuests = activeQuests.filter((q: any) => !q.deadline || new Date(q.deadline) >= today);

    // Health score: penalize stale quests, reward completions
    const healthScore = Math.max(
      1,
      Math.min(10, 10 - staleQuests.length * 2 + Math.floor(completedQuests.length / 3))
    );

    const dateStr = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const lines: string[] = [`COMPREHENSIVE SYSTEM REVIEW — ${dateStr}\n`];

    // QUEST HEALTH
    lines.push("QUEST HEALTH");
    lines.push(`  Active (${activeQuests.length}) | Completed (${completedQuests.length}) | Health Score: ${healthScore}/10`);
    if (staleQuests.length > 0) {
      lines.push(`  Stale quests (overdue deadline):`);
      staleQuests.forEach((q: any) => {
        const overdueDays = Math.floor((today.getTime() - new Date(q.deadline).getTime()) / (24 * 60 * 60 * 1000));
        lines.push(`    • ${q.title} — overdue by ${overdueDays} day${overdueDays !== 1 ? "s" : ""}`);
      });
    } else {
      lines.push("  Stale quests: None");
    }
    if (onTrackQuests.length > 0) {
      lines.push("  On track:");
      onTrackQuests.slice(0, 5).forEach((q: any) => {
        const deadline = q.deadline ? ` — due ${new Date(q.deadline).toLocaleDateString()}` : "";
        lines.push(`    • ${q.title}${deadline}`);
      });
    } else {
      lines.push("  On track: None");
    }

    // JOURNAL COVERAGE
    lines.push("\nJOURNAL COVERAGE");
    if (journal.length > 0) {
      const lastEntry = journal[0];
      const lastDate = new Date(lastEntry.created_at);
      const gapDays = Math.floor((today.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
      const gapWarning = gapDays > 3 ? " — WARNING: Long gap in journal entries" : "";
      lines.push(`  Last entry: ${lastDate.toLocaleDateString()}`);
      lines.push(`  Gap: ${gapDays} day${gapDays !== 1 ? "s" : ""} since last entry${gapWarning}`);

      const moods = journal.map((e: any) => e.mood).filter(Boolean);
      if (moods.length > 0) {
        lines.push(`  Mood trend: ${moods.join(" → ")}`);
      }

      const categories = [...new Set(journal.map((e: any) => e.category).filter(Boolean))];
      if (categories.length > 0) {
        lines.push(`  Categories covered: ${categories.join(", ")}`);
      }
    } else {
      lines.push("  No journal entries found.");
    }

    // ENERGY SYSTEMS
    lines.push("\nENERGY SYSTEMS");
    if (energy.length === 0) {
      lines.push("  No energy systems tracked.");
    } else {
      energy.forEach((e: any) => {
        const max = e.max_value || 100;
        const pct = Math.round((e.current_value / max) * 100);
        const filled = Math.round(pct / 10);
        const bar = "█".repeat(filled) + "░".repeat(10 - filled);
        const warning = pct < 40 ? " — WARNING: LOW" : "";
        lines.push(`  ${e.type}: ${bar} ${pct}%${warning}`);
      });
    }

    // ALLY NETWORK HEALTH
    lines.push("\nALLY NETWORK HEALTH");
    if (allies.length === 0) {
      lines.push("  No allies in network.");
    } else {
      const avgAffinity = Math.round(allies.reduce((sum: number, a: any) => sum + (a.affinity ?? 0), 0) / allies.length);
      const needsAttention = allies.filter((a: any) => (a.affinity ?? 0) < 40);
      const strongBonds = allies.filter((a: any) => (a.affinity ?? 0) > 75);
      lines.push(`  Total allies: ${allies.length}`);
      lines.push(`  Avg affinity: ${avgAffinity}/100`);
      if (needsAttention.length > 0) {
        lines.push(`  Needs attention (affinity < 40): ${needsAttention.map((a: any) => a.name).join(", ")}`);
      } else {
        lines.push("  Needs attention: None");
      }
      if (strongBonds.length > 0) {
        lines.push(`  Strong bonds (affinity > 75): ${strongBonds.map((a: any) => a.name).join(", ")}`);
      } else {
        lines.push("  Strong bonds: None yet");
      }
    }

    // MEMORY CONTINUITY
    lines.push("\nMEMORY CONTINUITY");
    if (memories.length === 0) {
      lines.push("  Archived memories: 0");
      lines.push("  Coverage gaps: No memories archived — consider running a memory consolidation.");
    } else {
      lines.push(`  Archived memories: ${memories.length}`);
      lines.push(`  Most recent: ${memories[0].title ?? "(untitled)"}`);
    }

    // RECOMMENDED PRIORITIES
    lines.push("\nRECOMMENDED PRIORITIES");
    const priorities: string[] = [];

    if (staleQuests.length > 0) {
      priorities.push(`Resolve ${staleQuests.length} overdue quest${staleQuests.length > 1 ? "s" : ""} — "${staleQuests[0].title}" is most urgent.`);
    }

    const lowEnergyTypes = energy.filter((e: any) => (e.current_value / (e.max_value || 100)) < 0.4);
    if (lowEnergyTypes.length > 0) {
      priorities.push(`Restore low energy: ${lowEnergyTypes.map((e: any) => e.type).join(", ")} — prioritize recovery activities.`);
    }

    const neglectedAllies = allies.filter((a: any) => (a.affinity ?? 0) < 40);
    if (neglectedAllies.length > 0) {
      priorities.push(`Reconnect with ${neglectedAllies[0].name} — affinity is low. A brief check-in could strengthen this bond.`);
    }

    const lastJournalDate = journal.length > 0 ? new Date(journal[0].created_at) : null;
    const journalGap = lastJournalDate ? Math.floor((today.getTime() - lastJournalDate.getTime()) / (24 * 60 * 60 * 1000)) : 999;
    if (journalGap > 3) {
      priorities.push("Journal entry overdue — reflection gap detected. Write even a brief entry to maintain continuity.");
    }

    if (memories.length === 0) {
      priorities.push("Archive key memories — no memory continuity detected. Run a memory extraction session.");
    }

    if (priorities.length === 0) {
      priorities.push("System is healthy. Continue current momentum.");
      priorities.push("Consider setting a new quest to expand your mission scope.");
      priorities.push("Maintain ally relationships — schedule a check-in this week.");
    }

    priorities.slice(0, 3).forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));

    return { skillName: "comprehensive-review", output: lines.join("\n") };
  } catch (err) {
    return {
      skillName: "comprehensive-review",
      output: `Comprehensive review unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill({
  name: "comprehensive-review",
  description: "REFLECT mode — full system scan across quests, journal, energy, allies, and memories with prioritized recommendations",
  keywords: [
    "reflect",
    "comprehensive review",
    "system scan",
    "weekly review",
    "full review",
    "status of everything",
    "how am i doing",
    "system audit",
  ],
}, handler);
