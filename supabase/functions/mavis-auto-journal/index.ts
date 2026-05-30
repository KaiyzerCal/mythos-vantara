import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const startOfDay = todayIso + "T00:00:00Z";

    // Run all queries in parallel
    const [
      tasksResult,
      questsResult,
      timeResult,
      meetingsResult,
      revenueResult,
      habitsResult,
      goalsResult,
    ] = await Promise.all([
      // Tasks completed today
      supabase
        .from("tasks")
        .select("title, type, xp_reward")
        .eq("user_id", uid)
        .gte("updated_at", startOfDay)
        .eq("status", "completed"),

      // Quests updated today
      supabase
        .from("quests")
        .select("title, status, progress_current, progress_target")
        .eq("user_id", uid)
        .gte("updated_at", startOfDay),

      // Time logged today (graceful)
      supabase
        .from("mavis_time_entries")
        .select("title, duration_minutes, category")
        .eq("user_id", uid)
        .gte("start_time", startOfDay)
        .then((r) => ({ data: r.data ?? [], error: null }))
        .catch(() => ({ data: [], error: null })),

      // Meetings today (graceful, limit 3)
      supabase
        .from("mavis_meetings")
        .select("title, summary")
        .eq("user_id", uid)
        .gte("created_at", startOfDay)
        .limit(3)
        .then((r) => ({ data: r.data ?? [], error: null }))
        .catch(() => ({ data: [], error: null })),

      // Revenue today (graceful)
      supabase
        .from("mavis_revenue")
        .select("amount, source")
        .eq("user_id", uid)
        .gte("created_at", startOfDay)
        .then((r) => ({ data: r.data ?? [], error: null }))
        .catch(() => ({ data: [], error: null })),

      // Habits with streak > 0 updated today
      supabase
        .from("tasks")
        .select("title, streak")
        .eq("user_id", uid)
        .eq("type", "habit")
        .gte("updated_at", startOfDay)
        .gt("streak", 0),

      // Active goals (limit 3)
      supabase
        .from("mavis_goals")
        .select("objective")
        .eq("user_id", uid)
        .eq("status", "active")
        .limit(3)
        .then((r) => ({ data: r.data ?? [], error: null }))
        .catch(() => ({ data: [], error: null })),
    ]);

    const tasks = tasksResult.data ?? [];
    const quests = questsResult.data ?? [];
    const timeEntries = timeResult.data ?? [];
    const meetings = meetingsResult.data ?? [];
    const revenue = revenueResult.data ?? [];
    const habits = habitsResult.data ?? [];
    const goals = goalsResult.data ?? [];

    // Skip if nothing happened today
    if (
      tasks.length === 0 &&
      quests.length === 0 &&
      timeEntries.length === 0 &&
      meetings.length === 0 &&
      revenue.length === 0 &&
      habits.length === 0
    ) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build context string
    const contextLines: string[] = [`Date: ${todayIso}`, ""];

    if (tasks.length > 0) {
      contextLines.push("Tasks completed:");
      tasks.forEach((t: { title: string; type: string; xp_reward: number }) => {
        contextLines.push(`  - ${t.title} (${t.type}, +${t.xp_reward ?? 0} XP)`);
      });
      contextLines.push("");
    }

    if (quests.length > 0) {
      contextLines.push("Quests updated:");
      quests.forEach((q: { title: string; status: string; progress_current: number; progress_target: number }) => {
        contextLines.push(`  - ${q.title}: ${q.status} (${q.progress_current ?? 0}/${q.progress_target ?? 0})`);
      });
      contextLines.push("");
    }

    if (timeEntries.length > 0) {
      contextLines.push("Time logged:");
      timeEntries.forEach((e: { title: string; duration_minutes: number; category: string }) => {
        contextLines.push(`  - ${e.title}: ${e.duration_minutes}min (${e.category})`);
      });
      contextLines.push("");
    }

    if (meetings.length > 0) {
      contextLines.push("Meetings:");
      meetings.forEach((m: { title: string; summary: string }) => {
        contextLines.push(`  - ${m.title}${m.summary ? ": " + m.summary : ""}`);
      });
      contextLines.push("");
    }

    if (revenue.length > 0) {
      const totalRevenue = revenue.reduce((sum: number, r: { amount: number; source: string }) => sum + (r.amount ?? 0), 0);
      contextLines.push(`Revenue: $${totalRevenue.toFixed(2)} total`);
      revenue.forEach((r: { amount: number; source: string }) => {
        contextLines.push(`  - $${r.amount} from ${r.source}`);
      });
      contextLines.push("");
    }

    if (habits.length > 0) {
      contextLines.push("Habits maintained:");
      habits.forEach((h: { title: string; streak: number }) => {
        contextLines.push(`  - ${h.title} (streak: ${h.streak} days)`);
      });
      contextLines.push("");
    }

    if (goals.length > 0) {
      contextLines.push("Active goals (context):");
      goals.forEach((g: { objective: string }) => {
        contextLines.push(`  - ${g.objective}`);
      });
    }

    const contextStr = contextLines.join("\n");

    // Call Claude Haiku
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system:
          "You are MAVIS writing an end-of-day journal entry ON BEHALF of your operator in first person ('Today I...'). Write 2-3 paragraphs. Tone: reflective, direct, honest. Reference actual data provided. Note wins, note what didn't happen, suggest one thing for tomorrow. No fluff.",
        messages: [{ role: "user", content: contextStr }],
      }),
    });

    const anthropicData = await anthropicRes.json();
    const draftText: string =
      anthropicData.content?.[0]?.text ?? "No journal entry generated.";

    // Check if a journal entry already exists for today with auto-journal tag
    const { data: existingEntries } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("user_id", uid)
      .contains("tags", ["auto-journal"])
      .gte("created_at", startOfDay)
      .limit(1);

    if (existingEntries && existingEntries.length > 0) {
      // Update existing entry
      await supabase
        .from("journal_entries")
        .update({ content: draftText, updated_at: new Date().toISOString() })
        .eq("id", existingEntries[0].id);
    } else {
      // Insert new entry
      await supabase.from("journal_entries").insert({
        user_id: uid,
        title: "Daily Log — " + todayIso,
        content: draftText,
        mood: "reflective",
        tags: ["auto-journal", "mavis-generated"],
        category: "daily",
      });
    }

    // Send Telegram notification
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const chatId = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID")!;
    const telegramMsg =
      `MAVIS AUTO-JOURNAL ✍️\n─────\nYour daily log for ${todayIso} has been drafted in Journal.\n\n${draftText.slice(0, 500)}…\n\n→ Review and edit in the Journal tab`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: telegramMsg }),
    });

    return new Response(JSON.stringify({ ok: true, date: todayIso }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("mavis-auto-journal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
