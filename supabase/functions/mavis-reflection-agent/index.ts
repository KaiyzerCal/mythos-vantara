// mavis-reflection-agent
// MAVIS reviews its own performance weekly and proposes improvements.
// Analyzes: task success/failure rates, standing order health, goal velocity,
// revenue trends. Generates a structured report stored in mavis_memory and
// proposes new standing orders where gaps are found.
//
// Actions: run_reflection | get_last_report
// Scheduled task type: weekly_reflection

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_SRK     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHRO_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const BOT_TOKEN  = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID    = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHRO_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "run_reflection");
    const userId = String(body.userId ?? body.user_id ?? "");
    const sb     = createClient(SB_URL, SB_SRK);

    // ── get_last_report ───────────────────────────────────────────────────────
    if (action === "get_last_report") {
      const { data } = await sb
        .from("mavis_memory")
        .select("content, created_at")
        .eq("user_id", userId)
        .contains("tags", ["reflection_report"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      return json({ report: data?.content ?? null, generated_at: data?.created_at ?? null });
    }

    // ── run_reflection ────────────────────────────────────────────────────────
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

    // Gather data in parallel
    const [tasksRes, soRes, goalsRes, revenueRes] = await Promise.all([
      sb.from("mavis_tasks")
        .select("type, status, error, created_at, completed_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),

      sb.from("standing_order_templates")
        .select("name, slug, usage_count, success_count, last_used_at, is_active")
        .eq("user_id", userId)
        .order("usage_count", { ascending: false })
        .limit(20),

      sb.from("mavis_goals")
        .select("title, status, progress, updated_at")
        .eq("user_id", userId)
        .in("status", ["active", "completed", "abandoned"])
        .gte("updated_at", since30)
        .limit(20),

      sb.from("mavis_revenue")
        .select("amount, source, currency, created_at")
        .eq("user_id", userId)
        .gte("created_at", since30)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const tasks   = tasksRes.data ?? [];
    const sos     = soRes.data   ?? [];
    const goals   = goalsRes.data ?? [];
    const revenue = revenueRes.data ?? [];

    // Compute task stats
    const total     = tasks.length;
    const completed = tasks.filter(t => t.status === "completed").length;
    const failed    = tasks.filter(t => t.status === "failed").length;
    const byType    = tasks.reduce((acc, t) => {
      if (!acc[t.type]) acc[t.type] = { total: 0, completed: 0, failed: 0 };
      acc[t.type].total++;
      if (t.status === "completed") acc[t.type].completed++;
      if (t.status === "failed")    acc[t.type].failed++;
      return acc;
    }, {} as Record<string, { total: number; completed: number; failed: number }>);

    // Revenue summary
    const revTotal  = revenue.reduce((s, r) => s + Number(r.amount), 0);
    const rev7d     = revenue.filter(r => r.created_at >= since).reduce((s, r) => s + Number(r.amount), 0);
    const revBySource = revenue.reduce((acc, r) => {
      acc[r.source] = (acc[r.source] ?? 0) + Number(r.amount);
      return acc;
    }, {} as Record<string, number>);

    const dataSnapshot = `
TASK PERFORMANCE (last 7 days):
Total: ${total} | Completed: ${completed} | Failed: ${failed} | Success rate: ${total > 0 ? Math.round(completed/total*100) : 0}%

By type:
${Object.entries(byType)
  .sort((a, b) => b[1].total - a[1].total)
  .map(([type, s]) => `  ${type}: ${s.completed}/${s.total} (${s.failed} failed)`)
  .join("\n")}

STANDING ORDERS:
${sos.map(s => `  ${s.name}: ${s.usage_count} runs, ${s.success_count} succeeded, active=${s.is_active}, last=${s.last_used_at?.split("T")[0] ?? "never"}`).join("\n")}

GOALS (last 30 days):
${goals.map(g => `  [${g.status}] ${g.title} — ${g.progress ?? 0}% complete`).join("\n")}

REVENUE:
  Last 30 days: $${revTotal.toFixed(2)}
  Last 7 days:  $${rev7d.toFixed(2)}
  By source: ${Object.entries(revBySource).map(([k, v]) => `${k}: $${v.toFixed(2)}`).join(", ")}
`;

    const report = await callClaude(
      `You are MAVIS's self-improvement engine. Analyze performance data and produce a structured weekly reflection.

Be direct and actionable. Format output as:

## WEEKLY REFLECTION REPORT

### Performance Summary
[2-3 sentence overall assessment]

### What's Working
- [bullet points — specific, data-backed]

### What Needs Fixing
- [bullet points — specific task types, failure patterns]

### Blind Spots / Gaps
- [things MAVIS is NOT doing that it should be]

### Recommended Actions
1. [specific, implementable recommendation]
2. [...]

### Proposed Standing Orders
[Only if there's a clear automation gap. Format: "New SO: [name] — [what it should do]"]

### Revenue Velocity
[Assessment of revenue trend]`,
      dataSnapshot
    );

    // Store report in memory
    await sb.from("mavis_memory").insert({
      user_id:          userId,
      role:             "assistant",
      content:          report,
      importance_score: 9,
      tags:             ["reflection_report", "self_improvement", "weekly"],
    });

    // Send condensed Telegram notification
    const brief = report.split("### Recommended Actions")[1]?.split("###")[0]?.trim() ?? "Report stored in memory.";
    await sendTelegram(`🪞 *MAVIS Weekly Reflection*\n\n*Recommended Actions:*\n${brief.slice(0, 800)}`);

    return json({
      report,
      stats: { total_tasks: total, success_rate: total > 0 ? Math.round(completed/total*100) : 0, revenue_7d: rev7d, revenue_30d: revTotal },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-reflection-agent]", message);
    return json({ error: message }, 500);
  }
});
