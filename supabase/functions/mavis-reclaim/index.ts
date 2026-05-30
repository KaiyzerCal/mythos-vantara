// MAVIS Reclaim — Reclaim.ai Schedule Defense + Health Integration
// Proactive schedule defense tied to WHOOP / Galaxy Ring health data.
// Smart task and habit scheduling that respects recovery metrics.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RECLAIM_KEY = Deno.env.get("RECLAIM_API_KEY") ?? "";
const RECLAIM_BASE = "https://api.app.reclaim.ai/api";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// HRV threshold below which we recommend reduced intensity (ms)
const HRV_LOW_THRESHOLD = 40;

// ─────────────────────────────────────────────────────────────
// Reclaim.ai API helper
// ─────────────────────────────────────────────────────────────

async function reclaimFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const res = await fetch(`${RECLAIM_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${RECLAIM_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Reclaim ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// Action handlers
// ─────────────────────────────────────────────────────────────

async function getTasks(): Promise<unknown> {
  return reclaimFetch("/tasks?status=NEW,IN_PROGRESS&limit=20");
}

async function getHabits(): Promise<unknown> {
  return reclaimFetch("/habits");
}

async function createTask(task: Record<string, unknown>): Promise<unknown> {
  const payload = {
    title: task.title ?? "Untitled Task",
    dueDate: task.dueDate ?? null,
    duration: task.duration ?? { minutes: 30 },
    priority: task.priority ?? "MEDIUM",
    notes: task.notes ?? "",
    alwaysPrivate: false,
    ...task,
  };
  return reclaimFetch("/tasks", "POST", payload);
}

async function createHabit(habit: Record<string, unknown>): Promise<unknown> {
  const payload = {
    title: habit.title ?? "Untitled Habit",
    duration: habit.duration ?? { minutes: 30 },
    idealDay: habit.idealDay ?? null,
    alwaysPrivate: false,
    enabled: true,
    ...habit,
  };
  return reclaimFetch("/habits", "POST", payload);
}

async function getSchedule(): Promise<unknown> {
  return reclaimFetch("/planner/calendar?days=7");
}

async function defendBlock(block: {
  title: string;
  startTime: string;
  endTime: string;
  eventType?: "FOCUS" | "PERSONAL";
}): Promise<unknown> {
  const payload = {
    title: block.title,
    startTime: block.startTime,
    endTime: block.endTime,
    eventType: block.eventType ?? "FOCUS",
  };
  return reclaimFetch("/planner/create-event", "POST", payload);
}

// ─────────────────────────────────────────────────────────────
// Health-triggered schedule sync
// ─────────────────────────────────────────────────────────────

interface HealthData {
  recovery_score?: number;
  hrv?: number;
  hrv_rmssd?: number;
  resting_hr?: number;
  sleep_hours?: number;
  strain_score?: number;
  date?: string;
}

async function syncHealth(
  userId: string,
  healthData: HealthData,
  supabase: ReturnType<typeof createClient>,
): Promise<unknown> {
  const recovery = healthData.recovery_score ?? 100;
  const hrv = healthData.hrv ?? healthData.hrv_rmssd ?? HRV_LOW_THRESHOLD + 1;
  const targetDate = healthData.date ?? new Date().toISOString().slice(0, 10);

  const actions: string[] = [];
  const blocks: unknown[] = [];

  // Low recovery: defend recovery break blocks
  if (recovery < 50) {
    // Create two 30-minute recovery blocks during the day
    const breakTimes = [
      { hour: 10, label: "Morning Recovery Break" },
      { hour: 15, label: "Afternoon Recovery Break" },
    ];

    for (const { hour, label } of breakTimes) {
      const startTime = `${targetDate}T${String(hour).padStart(2, "0")}:00:00`;
      const endTime = `${targetDate}T${String(hour).padStart(2, "0")}:30:00`;

      try {
        const block = await defendBlock({
          title: `[MAVIS] ${label} (Recovery: ${recovery}%)`,
          startTime,
          endTime,
          eventType: "PERSONAL",
        });
        blocks.push(block);

        // Cache in DB
        await cacheScheduleBlock(supabase, userId, {
          title: `${label} (Recovery: ${recovery}%)`,
          start_time: startTime,
          end_time: endTime,
          block_type: "recovery",
          health_triggered: true,
          reclaim_task_id: null,
        });

        actions.push(`Defended ${label} block at ${hour}:00`);
      } catch (err) {
        actions.push(`Failed to defend ${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Low HRV: log recommendation to reduce intensity (no auto-block, just note)
  if (hrv < HRV_LOW_THRESHOLD) {
    actions.push(
      `HRV is low (${hrv} ms < ${HRV_LOW_THRESHOLD} ms threshold). Recommend reducing workout intensity today.`,
    );
  }

  // Good recovery: suggest a productive focus block
  if (recovery >= 80) {
    actions.push(`Recovery is excellent (${recovery}%). Consider scheduling a deep work block.`);
  }

  return {
    recovery_score: recovery,
    hrv,
    actions,
    blocks_created: blocks.length,
    blocks,
    recommendation: recovery < 50
      ? "Low recovery detected. Protected two 30-minute recovery breaks."
      : hrv < HRV_LOW_THRESHOLD
      ? "HRV is below threshold. Reduce workout intensity today."
      : "Recovery looks good. Carry on with your planned schedule.",
  };
}

// ─────────────────────────────────────────────────────────────
// DB cache helper
// ─────────────────────────────────────────────────────────────

async function cacheScheduleBlock(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  block: {
    title: string;
    start_time: string;
    end_time: string;
    block_type: string;
    health_triggered: boolean;
    reclaim_task_id: string | null;
  },
): Promise<void> {
  try {
    await supabase.from("reclaim_schedule_blocks").insert({
      user_id: userId,
      reclaim_task_id: block.reclaim_task_id,
      title: block.title,
      start_time: block.start_time,
      end_time: block.end_time,
      block_type: block.block_type,
      health_triggered: block.health_triggered,
      synced_at: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!RECLAIM_KEY) {
    return new Response(
      JSON.stringify({
        error: "Reclaim.ai not configured",
        connect_url: "https://app.reclaim.ai/settings/api",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const {
      action,
      user_id,
      task,
      habit,
      date,
      health_data,
    }: {
      action: string;
      user_id: string;
      task?: Record<string, unknown>;
      habit?: Record<string, unknown>;
      date?: string;
      health_data?: HealthData;
    } = body;

    if (!action || !user_id) {
      return new Response(
        JSON.stringify({ error: "action and user_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let result: unknown;

    switch (action) {
      case "get_tasks":
        result = await getTasks();
        break;

      case "get_habits":
        result = await getHabits();
        break;

      case "create_task": {
        if (!task) {
          return new Response(
            JSON.stringify({ error: "task object required for create_task" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await createTask(task);
        // Cache block if time info present
        if (result && typeof result === "object") {
          const t = result as Record<string, unknown>;
          if (t.startTime && t.endTime) {
            await cacheScheduleBlock(supabase, user_id, {
              title: String(task.title ?? "Task"),
              start_time: String(t.startTime),
              end_time: String(t.endTime),
              block_type: "task",
              health_triggered: false,
              reclaim_task_id: t.id ? String(t.id) : null,
            });
          }
        }
        break;
      }

      case "create_habit": {
        if (!habit) {
          return new Response(
            JSON.stringify({ error: "habit object required for create_habit" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await createHabit(habit);
        break;
      }

      case "get_schedule":
        result = await getSchedule();
        break;

      case "defend_block": {
        const blockData = body.block as {
          title: string;
          startTime: string;
          endTime: string;
          eventType?: "FOCUS" | "PERSONAL";
        } | undefined;

        if (!blockData?.title || !blockData?.startTime || !blockData?.endTime) {
          return new Response(
            JSON.stringify({ error: "block.title, block.startTime, block.endTime required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await defendBlock(blockData);
        await cacheScheduleBlock(supabase, user_id, {
          title: blockData.title,
          start_time: blockData.startTime,
          end_time: blockData.endTime,
          block_type: blockData.eventType?.toLowerCase() ?? "focus",
          health_triggered: false,
          reclaim_task_id: null,
        });
        break;
      }

      case "sync_health": {
        if (!health_data) {
          return new Response(
            JSON.stringify({ error: "health_data required for sync_health" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        result = await syncHealth(user_id, health_data, supabase);
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    return new Response(
      JSON.stringify({ status: "ok", action, data: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-reclaim]", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
