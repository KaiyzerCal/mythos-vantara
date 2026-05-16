// MAVIS Morning Brief
// Fires at 06:00 UTC daily. Pushes a structured daily briefing to Telegram:
// pending approvals, overdue quests, today's tasks, SR notes due, revenue delta, council alerts.
// Also callable via /brief Telegram command.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…[truncated]" : text;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: payload }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    if (!OPERATOR_USER_ID) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");
    const uid = OPERATOR_USER_ID;
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const yesterdayIso = new Date(now.getTime() - 86400000).toISOString();

    const [
      approvalsRes, questsRes, tasksRes, srRes,
      revenueRes, expensesRes, councilRes, bondRes,
    ] = await Promise.all([
      // Pending approvals
      supabase.from("mavis_tasks")
        .select("id, type, description, created_at")
        .eq("user_id", uid)
        .eq("status", "requires_confirmation")
        .order("created_at", { ascending: false })
        .limit(5),

      // Overdue quests
      supabase.from("quests")
        .select("title, deadline, type")
        .eq("user_id", uid)
        .eq("status", "active")
        .lt("deadline", todayIso)
        .not("deadline", "is", null)
        .limit(5),

      // Today's active tasks (habits due)
      supabase.from("tasks")
        .select("title, recurrence, streak, completed_count")
        .eq("user_id", uid)
        .eq("status", "active")
        .in("recurrence", ["daily", "weekly"])
        .limit(8),

      // Notes due for spaced repetition today
      supabase.from("mavis_notes")
        .select("title, review_interval_days")
        .eq("user_id", uid)
        .lte("next_review_at", now.toISOString())
        .not("tags", "cs", '["daily-log"]')
        .limit(3),

      // Revenue since yesterday
      supabase.from("mavis_revenue")
        .select("amount, source")
        .eq("user_id", uid)
        .gte("created_at", yesterdayIso),

      // Expenses since yesterday
      supabase.from("mavis_expenses")
        .select("amount, description")
        .eq("user_id", uid)
        .gte("expense_date", todayIso),

      // Council recent activity
      supabase.from("mavis_council_activity")
        .select("member_name, summary, actions_executed")
        .eq("user_id", uid)
        .gte("created_at", yesterdayIso)
        .order("created_at", { ascending: false })
        .limit(3),

      // Operator bond
      supabase.from("mavis_bond")
        .select("interaction_count, bond_level, trust_level")
        .eq("user_id", uid)
        .single(),
    ]);

    const approvals = (approvalsRes.data ?? []) as any[];
    const overdue   = (questsRes.data ?? []) as any[];
    const tasks     = (tasksRes.data ?? []) as any[];
    const srNotes   = (srRes.data ?? []) as any[];
    const revenue   = (revenueRes.data ?? []) as any[];
    const expenses  = (expensesRes.data ?? []) as any[];
    const council   = (councilRes.data ?? []) as any[];
    const bond      = bondRes.data as any;

    const totalRevenue  = revenue.reduce((s: number, r: any) => s + Number(r.amount), 0);
    const totalExpenses = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);

    const dayName = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

    const sections: string[] = [
      `MAVIS MORNING BRIEF — ${dayName}, ${dateStr}`,
      "─────────────────────────",
    ];

    if (approvals.length > 0) {
      sections.push(`NEEDS YOUR APPROVAL (${approvals.length})\n${approvals.map((t: any) =>
        `• [${t.type}] ${(t.description ?? "").slice(0, 60)}\n  ID: ${t.id.slice(0, 8)}`
      ).join("\n")}\n→ Use /approve [id] or /reject [id]`);
    }

    if (overdue.length > 0) {
      sections.push(`OVERDUE QUESTS (${overdue.length})\n${overdue.map((q: any) =>
        `• ${q.title} — was due ${q.deadline}`
      ).join("\n")}`);
    }

    if (tasks.length > 0) {
      sections.push(`TODAY'S TASKS (${tasks.length})\n${tasks.map((t: any) =>
        `• ${t.title}${t.streak > 0 ? ` (streak: ${t.streak})` : ""}`
      ).join("\n")}`);
    }

    if (srNotes.length > 0) {
      sections.push(`KNOWLEDGE REVIEW (${srNotes.length} notes due)\n${srNotes.map((n: any) =>
        `• ${n.title} (every ${n.review_interval_days ?? 7}d)`
      ).join("\n")}\n→ Use /review to surface them`);
    }

    if (totalRevenue > 0 || totalExpenses > 0) {
      const net = totalRevenue - totalExpenses;
      const parts = [];
      if (totalRevenue > 0) parts.push(`+$${totalRevenue.toFixed(2)} revenue`);
      if (totalExpenses > 0) parts.push(`-$${totalExpenses.toFixed(2)} expenses`);
      parts.push(`net $${net.toFixed(2)}`);
      sections.push(`LAST 24H FINANCES\n${parts.join(" · ")}`);
    }

    if (council.length > 0) {
      const totalActions = council.reduce((s: number, c: any) => s + Number(c.actions_executed ?? 0), 0);
      sections.push(`COUNCIL (${totalActions} actions overnight)\n${council.map((c: any) =>
        `• ${c.member_name}: ${(c.summary ?? "").slice(0, 60)}`
      ).join("\n")}`);
    }

    if (bond) {
      sections.push(`OPERATOR BOND\nInteractions: ${bond.interaction_count} · Bond: ${bond.bond_level} · Trust: ${bond.trust_level}`);
    }

    if (sections.length === 2) {
      sections.push("All clear. No pending items, no overdue quests, no SR reviews.\nHave a focused day.");
    }

    await sendTelegram(sections.join("\n\n"));

    return new Response(
      JSON.stringify({ ok: true, sections: sections.length - 2 }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[mavis-morning-brief]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
