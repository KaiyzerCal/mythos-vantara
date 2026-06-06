// mavis-autonomous-engine
// Dispatched by pg_cron every 5 minutes.
// Handles: scheduled workflow runs + any task-based autonomous actions.
// Also callable directly for one-off autonomous tasks.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function callFunction(name: string, body: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55000),
    });
    return { ok: res.ok, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const task: string = body.task ?? "run_scheduled_workflows";

    const dispatched: string[] = [];

    // ── Run scheduled workflows ────────────────────────────────────────────
    if (task === "run_scheduled_workflows") {
      const now = new Date();

      // Find workflows with schedule trigger that are due
      const { data: workflows } = await adminSb
        .from("workflows")
        .select("id, name, trigger_config, last_run_at")
        .eq("trigger_type", "schedule")
        .eq("is_active", true);

      for (const wf of workflows ?? []) {
        if (!wf.trigger_config?.cron) continue;

        // Simple cron check: if last_run_at was more than (schedule interval) ago
        const lastRun = wf.last_run_at ? new Date(wf.last_run_at) : new Date(0);
        const cronExpr: string = wf.trigger_config.cron;

        // Determine if due based on cron expression (simplified: check minutes/hours)
        const isDue = isCronDue(cronExpr, lastRun, now);
        if (!isDue) continue;

        const result = await callFunction("mavis-workflow-run", { workflow_id: wf.id });
        if (result.ok) dispatched.push(`workflow:${wf.name}`);
      }
    }

    // ── Other autonomous tasks ─────────────────────────────────────────────
    if (task === "health_check") {
      // Check all critical functions and log any issues
      const checks = ["mavis-chat", "mavis-morning-brief", "mavis-goal-engine"];
      for (const fn of checks) {
        const r = await callFunction(fn, { health_check: true });
        dispatched.push(`${fn}:${r.ok ? "ok" : "down"}`);
      }
    }

    // Log run
    await adminSb
      .from("mavis_autonomous_runs")
      .insert({ job_name: `autonomous-engine:${task}`, status: "ok", notes: dispatched.join(", ") })
      .catch(() => {});

    return json({ task, dispatched, timestamp: new Date().toISOString() });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("mavis-autonomous-engine error:", message);
    return json({ error: message }, 500);
  }
});

// ── Simplified cron due-check ──────────────────────────────────────────────
// Supports: @daily, @weekly, @hourly, and standard 5-field cron expressions
function isCronDue(cron: string, lastRun: Date, now: Date): boolean {
  const msSinceLastRun = now.getTime() - lastRun.getTime();

  if (cron === "@daily")  return msSinceLastRun >= 23.5 * 3600 * 1000;
  if (cron === "@weekly") return msSinceLastRun >= 6.9 * 24 * 3600 * 1000;
  if (cron === "@hourly") return msSinceLastRun >= 55 * 60 * 1000;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return msSinceLastRun >= 5 * 60 * 1000; // default 5-min

  const [minute, hour] = parts;

  // Every N minutes: */N
  if (minute.startsWith("*/")) {
    const n = parseInt(minute.slice(2));
    if (!isNaN(n)) return msSinceLastRun >= (n - 1) * 60 * 1000;
  }

  // Every N hours: 0 */N * * *
  if (hour.startsWith("*/") && minute === "0") {
    const n = parseInt(hour.slice(2));
    if (!isNaN(n)) return msSinceLastRun >= (n - 1) * 3600 * 1000;
  }

  // Specific time (e.g. 0 7 * * *): check if we're within 5 min of that time today
  if (!minute.includes("*") && !hour.includes("*")) {
    const targetMinute = parseInt(minute);
    const targetHour   = parseInt(hour);
    const nowMinute    = now.getUTCMinutes();
    const nowHour      = now.getUTCHours();
    const withinWindow = nowHour === targetHour && Math.abs(nowMinute - targetMinute) <= 5;
    return withinWindow && msSinceLastRun >= 23 * 3600 * 1000;
  }

  return false;
}
