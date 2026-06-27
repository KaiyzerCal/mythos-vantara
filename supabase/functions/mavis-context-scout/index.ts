// mavis-context-scout — OpenHuman SuperContext pattern
// Called at the start of a new MAVIS chat thread to assemble a rich context
// block from the user's live app state: quests, goals, tasks, journal, memories,
// and the Hermes-style user profile. Injected into MAVIS's system prompt so it
// "knows what's going on" before the user says a word.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { user_id } = await req.json() as { user_id: string };
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: CORS });
    }

    const now = new Date();

    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    const [
      profileRes,
      questsRes,
      goalsRes,
      tasksRes,
      journalRes,
      memoriesRes,
      insightsRes,
      moodRes,
    ] = await Promise.all([
      // Hermes-style user profile
      supabase.from("mavis_user_profile")
        .select("profile_md, communication_style, key_context, preferences, topics_of_interest")
        .eq("user_id", user_id)
        .maybeSingle(),

      // Active quests (top 6 by recent activity)
      supabase.from("quests")
        .select("title, type, status, deadline, xp_reward, progress_pct")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(6),

      // Active goals
      supabase.from("mavis_goals")
        .select("objective, context, status, target_date")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(3),

      // Pending + active tasks
      supabase.from("tasks")
        .select("title, recurrence, streak, priority, status")
        .eq("user_id", user_id)
        .in("status", ["active", "pending"])
        .order("priority", { ascending: false })
        .limit(5),

      // Recent journal entries (last 3)
      supabase.from("journal_entries")
        .select("title, content, created_at")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(3),

      // Recent auto-memories (last 8)
      supabase.from("memories")
        .select("title, content, memory_type, tags, created_at")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(8),

      // Recent MAVIS insights/alerts (last 3)
      supabase.from("mavis_insights")
        .select("title, content, category, severity")
        .eq("user_id", user_id)
        .in("severity", ["warning", "critical"])
        .order("created_at", { ascending: false })
        .limit(3),

      // Mood signals from journal entries (last 7 days)
      supabase.from("journal_entries")
        .select("mood, created_at")
        .eq("user_id", user_id)
        .gte("created_at", sevenDaysAgo)
        .not("mood", "is", null)
        .order("created_at", { ascending: false })
        .limit(7),
    ]);

    const profile  = profileRes.data;
    const quests   = questsRes.data   ?? [];
    const goals    = goalsRes.data    ?? [];
    const tasks    = tasksRes.data    ?? [];
    const journal  = journalRes.data  ?? [];
    const memories = memoriesRes.data ?? [];
    const insights = insightsRes.data ?? [];
    const moods    = moodRes.data     ?? [];

    const parts: string[] = [];

    // ── Hermes user profile ───────────────────────────────────────────
    if (profile?.profile_md?.trim()) {
      parts.push(`## WHO YOU ARE TALKING TO\n${profile.profile_md}`);
    }
    if (profile?.communication_style?.trim()) {
      parts.push(`## PREFERRED COMMUNICATION STYLE\n${profile.communication_style}`);
    }
    if (profile?.key_context?.trim()) {
      parts.push(`## STANDING KEY CONTEXT\n${profile.key_context}`);
    }
    if (profile?.topics_of_interest?.length) {
      parts.push(`## TOPICS OF INTEREST\n${(profile.topics_of_interest as string[]).join(", ")}`);
    }

    // ── Live app state ────────────────────────────────────────────────
    if (goals.length > 0) {
      parts.push(
        `## ACTIVE GOALS (${goals.length})\n` +
        goals.map((g: any) =>
          `- **${g.objective}**${g.target_date ? ` (target: ${g.target_date})` : ""}${g.context ? `\n  ${g.context.slice(0, 120)}` : ""}`
        ).join("\n")
      );
    }

    if (quests.length > 0) {
      parts.push(
        `## ACTIVE QUESTS (${quests.length})\n` +
        quests.map((q: any) =>
          `- ${q.title} [${q.type}]${q.deadline ? ` — due ${q.deadline}` : ""}${q.progress_pct != null ? ` — ${q.progress_pct}%` : ""}`
        ).join("\n")
      );
    }

    if (tasks.length > 0) {
      parts.push(
        `## PENDING TASKS\n` +
        tasks.map((t: any) =>
          `- ${t.title}${t.recurrence ? ` (${t.recurrence})` : ""}${t.streak > 0 ? ` — ${t.streak}d streak` : ""}`
        ).join("\n")
      );
    }

    if (journal.length > 0) {
      parts.push(
        `## RECENT JOURNAL\n` +
        journal.map((j: any) => {
          const daysAgo = Math.round((now.getTime() - new Date(j.created_at).getTime()) / 86400000);
          const preview = j.content?.replace(/<[^>]+>/g, "").trim().slice(0, 100) ?? "";
          return `- [${daysAgo === 0 ? "today" : `${daysAgo}d ago`}] **${j.title}**${preview ? `: ${preview}…` : ""}`;
        }).join("\n")
      );
    }

    if (memories.length > 0) {
      parts.push(
        `## MAVIS MEMORY\n` +
        memories.map((m: any) =>
          `- [${m.memory_type}] **${m.title}**: ${m.content?.slice(0, 120) ?? ""}${m.tags?.length ? ` #${m.tags.join(" #")}` : ""}`
        ).join("\n")
      );
    }

    if (insights.length > 0) {
      parts.push(
        `## ACTIVE ALERTS\n` +
        insights.map((i: any) => `- ⚡ [${i.severity.toUpperCase()}] ${i.title}: ${i.content?.slice(0, 100) ?? ""}`).join("\n")
      );
    }

    // ── Emotional state signal (OpenHuman pattern) ─────────────────────
    if (moods.length > 0) {
      const moodList = moods.map((m: any) => {
        const daysAgo = Math.round((now.getTime() - new Date(m.created_at).getTime()) / 86400000);
        return `${m.mood}${daysAgo === 0 ? " (today)" : daysAgo === 1 ? " (yesterday)" : ` (${daysAgo}d ago)`}`;
      });
      // Derive dominant mood from most recent entries
      const dominant = moods[0]?.mood ?? "neutral";
      const trendStr = moods.length >= 3
        ? ` — pattern across week: ${moodList.slice(0, 5).join(" → ")}`
        : "";
      parts.push(
        `## EMOTIONAL STATE\nMost recent: **${dominant}**${trendStr}\n` +
        `Adjust your communication style to this emotional context. If distressed or low-energy, be warmer and more supportive. If energized and focused, match their pace and be direct.`
      );
    }

    const context_block = parts.length > 0
      ? `╔══ MAVIS SUPERCONTEXT [assembled ${now.toUTCString()}] ══╗\n${parts.join("\n\n")}\n╚══ END SUPERCONTEXT ══╝`
      : "";

    return new Response(
      JSON.stringify({ context_block, sections: parts.length, has_profile: !!profile?.profile_md?.trim() }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (err) {
    console.error("[mavis-context-scout]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
