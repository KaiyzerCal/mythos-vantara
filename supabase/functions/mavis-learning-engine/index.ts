// mavis-learning-engine
// Runs daily at midnight UTC via pg_cron.
// Analyzes 30 days of behavioral signals to learn operator patterns:
//   - Active hours (when they're responsive, from message_received signals)
//   - Action approval/rejection rates per action type
//   - Tool usage frequency and success rates
// Auto-upgrades autonomy tiers for actions with >90% approval rate and >10 samples.
// Saves learned preferences to mavis_learned_preferences for mavis-agent to read.
// Sends Telegram summary of any tier upgrades.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN     = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const OPERATOR_UID  = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";

const TIER_RANK: Record<string, number> = { auto: 2, queue: 1, approve: 0 };

async function tgSend(text: string): Promise<void> {
  if (!BOT_TOKEN || !OPERATOR_CHAT) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: OPERATOR_CHAT, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function heartbeat(sb: ReturnType<typeof createClient>, status: "running" | "ok" | "error", error?: string) {
  await sb.from("mavis_function_health").upsert({
    function_name:       "mavis-learning-engine",
    last_started_at:     status === "running" ? new Date().toISOString() : undefined,
    last_completed_at:   status !== "running" ? new Date().toISOString() : undefined,
    last_status:         status,
    last_error:          error?.slice(0, 500) ?? null,
    run_count:           1,
    error_count:         status === "error" ? 1 : 0,
    expected_interval_min: 1440,
    updated_at:          new Date().toISOString(),
  }, { onConflict: "function_name" }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });

  const sb  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000).toISOString();

  await heartbeat(sb, "running");

  try {
    const uid = OPERATOR_UID;
    if (!uid) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");

    // ── Pull all signals from last 30 days ────────────────────────────────────
    const { data: rawSignals } = await sb
      .from("mavis_behavioral_signals")
      .select("signal_type, action_type, tool_name, outcome, hour_of_day, day_of_week")
      .eq("user_id", uid)
      .gte("created_at", thirtyDaysAgo)
      .limit(10000);

    const signals = (rawSignals ?? []) as any[];
    const changes: string[] = [];

    // ── 1. Active hours ───────────────────────────────────────────────────────
    const msgSignals = signals.filter((s: any) => s.signal_type === "message_received");
    if (msgSignals.length >= 5) {
      const hourCounts: Record<number, number> = {};
      for (const s of msgSignals) {
        if (s.hour_of_day !== null) hourCounts[s.hour_of_day] = (hourCounts[s.hour_of_day] ?? 0) + 1;
      }
      // Group into 3-hour windows
      const windowCounts: Record<string, { count: number; hours: number[] }> = {};
      for (const [h, count] of Object.entries(hourCounts)) {
        const hour = Number(h);
        const windowStart = Math.floor(hour / 3) * 3;
        const label = `${String(windowStart).padStart(2, "0")}:00–${String(windowStart + 3).padStart(2, "0")}:00 UTC`;
        if (!windowCounts[label]) windowCounts[label] = { count: 0, hours: [] };
        windowCounts[label].count += count as number;
        windowCounts[label].hours.push(hour);
      }
      const topWindows = Object.entries(windowCounts)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 4);

      for (const [label, { count }] of topWindows) {
        await sb.from("mavis_learned_preferences").upsert({
          user_id: uid,
          preference_type: "active_hours",
          key: label,
          value: { count, pct: Math.round((count / msgSignals.length) * 100) },
          confidence: Math.min(msgSignals.length / 50, 1.0),
          sample_size: msgSignals.length,
          updated_at: now.toISOString(),
        }, { onConflict: "user_id,preference_type,key" });
      }
    }

    // ── 2. Action approval rates ──────────────────────────────────────────────
    const actionSignals = signals.filter((s: any) =>
      s.signal_type === "action_approved" ||
      s.signal_type === "action_rejected" ||
      s.signal_type === "action_executed"
    );

    const actionStats: Record<string, { approved: number; rejected: number; executed: number }> = {};
    for (const s of actionSignals) {
      const t = s.action_type ?? "unknown";
      if (!actionStats[t]) actionStats[t] = { approved: 0, rejected: 0, executed: 0 };
      if (s.signal_type === "action_approved")  actionStats[t].approved++;
      else if (s.signal_type === "action_rejected") actionStats[t].rejected++;
      else if (s.signal_type === "action_executed") actionStats[t].executed++;
    }

    const autoUpgraded: string[] = [];

    for (const [actionType, stats] of Object.entries(actionStats)) {
      const total = stats.approved + stats.rejected;
      if (total < 3) continue;
      const rate = stats.approved / total;

      await sb.from("mavis_learned_preferences").upsert({
        user_id: uid,
        preference_type: "action_approval_rate",
        key: actionType,
        value: {
          rate: Math.round(rate * 100) / 100,
          approved: stats.approved,
          rejected: stats.rejected,
          executed: stats.executed,
        },
        confidence: Math.min(total / 20, 1.0),
        sample_size: total,
        updated_at: now.toISOString(),
      }, { onConflict: "user_id,preference_type,key" });

      // Auto-upgrade: >90% approval + >10 samples → queue tier; >98% → auto tier
      if (rate >= 0.90 && total >= 10) {
        const newTier = rate >= 0.98 ? "auto" : "queue";

        const { data: existing } = await sb.from("mavis_autonomy_config")
          .select("tier")
          .eq("user_id", uid)
          .eq("action_type", actionType)
          .maybeSingle();

        const currentRank = TIER_RANK[(existing?.tier as string) ?? "approve"] ?? 0;
        const newRank     = TIER_RANK[newTier];

        // Only upgrade (never downgrade to prevent thrashing)
        if (newRank > currentRank) {
          await sb.from("mavis_autonomy_config").upsert({
            user_id: uid,
            action_type: actionType,
            tier: newTier,
            updated_at: now.toISOString(),
          }, { onConflict: "user_id,action_type" });

          await sb.from("mavis_learned_preferences").upsert({
            user_id: uid,
            preference_type: "auto_upgraded_action",
            key: actionType,
            value: { tier: newTier, rate: Math.round(rate * 100) / 100, upgraded_at: now.toISOString() },
            confidence: Math.min(total / 20, 1.0),
            sample_size: total,
            updated_at: now.toISOString(),
          }, { onConflict: "user_id,preference_type,key" });

          autoUpgraded.push(`${actionType} → *${newTier}* (${Math.round(rate * 100)}% approval, ${total} samples)`);
        }
      }
    }

    if (autoUpgraded.length > 0) {
      changes.push(`Autonomy tier upgrades:\n${autoUpgraded.map(a => `  · ${a}`).join("\n")}`);
    }

    // ── 3. Tool frequency ─────────────────────────────────────────────────────
    const toolSignals = signals.filter((s: any) => s.signal_type === "tool_used");
    const toolCounts: Record<string, { total: number; success: number }> = {};
    for (const s of toolSignals) {
      const t = s.tool_name ?? "unknown";
      if (!toolCounts[t]) toolCounts[t] = { total: 0, success: 0 };
      toolCounts[t].total++;
      if (s.outcome === "success") toolCounts[t].success++;
    }

    for (const [toolName, stats] of Object.entries(toolCounts)) {
      await sb.from("mavis_learned_preferences").upsert({
        user_id: uid,
        preference_type: "tool_frequency",
        key: toolName,
        value: {
          total: stats.total,
          success: stats.success,
          success_rate: stats.total > 0 ? Math.round((stats.success / stats.total) * 100) / 100 : 0,
        },
        confidence: Math.min(stats.total / 30, 1.0),
        sample_size: stats.total,
        updated_at: now.toISOString(),
      }, { onConflict: "user_id,preference_type,key" });
    }

    // ── 4. Save digest to persona memory (searchable by MAVIS) ────────────────
    const topTools = Object.entries(toolCounts)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 5)
      .map(([name, s]) => `${name}(${s.total}x)`)
      .join(", ");

    const topActionRates = Object.entries(actionStats)
      .filter(([, s]) => s.approved + s.rejected >= 3)
      .sort(([, a], [, b]) => (b.approved + b.rejected) - (a.approved + a.rejected))
      .slice(0, 5)
      .map(([t, s]) => {
        const total = s.approved + s.rejected;
        return `${t}:${Math.round(s.approved / total * 100)}%`;
      })
      .join(", ");

    const digestValue = [
      `Learning engine ran ${now.toISOString().slice(0, 10)}.`,
      `${signals.length} signals analyzed (30-day window).`,
      topTools ? `Most-used tools: ${topTools}.` : "",
      topActionRates ? `Action approval rates: ${topActionRates}.` : "",
      autoUpgraded.length > 0 ? `Auto-upgraded: ${autoUpgraded.join("; ")}.` : "",
      msgSignals.length > 0 ? `${msgSignals.length} messages logged for active-hours pattern.` : "",
    ].filter(Boolean).join(" ");

    await sb.from("mavis_persona_memory").upsert({
      user_id:    uid,
      key:        `learning:weekly:${now.toISOString().slice(0, 10)}`,
      value:      digestValue,
      category:   "learning",
      importance: 6,
      source:     "mavis-learning-engine",
      role:       "system",
      created_at: now.toISOString(),
    }, { onConflict: "user_id,key" });

    // ── 5. Prune old signals (>90 days) ───────────────────────────────────────
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400_000).toISOString();
    await sb.from("mavis_behavioral_signals").delete().lt("created_at", ninetyDaysAgo);

    await heartbeat(sb, "ok");

    if (changes.length > 0) {
      await tgSend(`🧠 *MAVIS Learning Engine*\n\n${changes.join("\n\n")}`);
    }

    return new Response(JSON.stringify({
      ok:              true,
      signalsAnalyzed: signals.length,
      autoUpgraded:    autoUpgraded.length,
      changes,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await heartbeat(sb, "error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
