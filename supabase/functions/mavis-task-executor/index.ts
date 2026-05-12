// MAVIS Task Executor — the autonomous worker.
// Polls mavis_tasks for pending work and executes each by type.
// Scheduled via pg_cron every 15 minutes. Can also be triggered manually.
//
// To add a new task type: add a handler to HANDLERS below.
// Tasks write their result to the `result` JSON column on completion.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface Task {
  id: string;
  user_id: string;
  type: string;
  description: string | null;
  payload: Record<string, unknown>;
  status: string;
  scheduled_at: string | null;
}

type TaskResult = { success: boolean; output?: unknown; error?: string };
type TaskHandler = (task: Task) => Promise<TaskResult>;

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function callClaude(systemPrompt: string, userContent: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text ?? "";
}

async function markRunning(taskId: string) {
  await supabase.from("mavis_tasks").update({
    status: "running",
    started_at: new Date().toISOString(),
  }).eq("id", taskId);
}

async function markComplete(taskId: string, result: unknown, revenueGenerated = 0) {
  await supabase.from("mavis_tasks").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    result,
    revenue_generated: revenueGenerated,
  }).eq("id", taskId);
}

async function markFailed(taskId: string, error: string) {
  await supabase.from("mavis_tasks").update({
    status: "failed",
    completed_at: new Date().toISOString(),
    result: { error },
  }).eq("id", taskId);
}

// ─────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────

// daily_brief — generates a status brief and stores it as a completed result
const handleDailyBrief: TaskHandler = async (task) => {
  const uid = task.user_id;

  const [questsRes, tasksRes, energyRes] = await Promise.all([
    supabase.from("quests").select("id,title,status,type,deadline").eq("user_id", uid).eq("status", "active").order("deadline", { ascending: true }),
    supabase.from("tasks").select("id,title,status,recurrence,streak").eq("user_id", uid).eq("status", "active"),
    supabase.from("energy_systems").select("type,current_value,max_value,status").eq("user_id", uid),
  ]);

  const quests = questsRes.data ?? [];
  const habits = (tasksRes.data ?? []).filter((t: any) => t.recurrence === "daily");
  const energy = energyRes.data ?? [];

  const context = [
    `Active quests (${quests.length}): ${quests.slice(0, 5).map((q: any) => q.title).join(", ")}`,
    `Daily habits (${habits.length}): ${habits.slice(0, 5).map((t: any) => `${t.title} streak:${t.streak ?? 0}`).join(", ")}`,
    `Energy: ${energy.map((e: any) => `${e.type} ${e.current_value}/${e.max_value}`).join(", ")}`,
  ].join("\n");

  const brief = await callClaude(
    `You are MAVIS. Generate a concise daily brief for the operator. 3–5 bullets. Direct, sovereign tone. Reference specific data. Flag anything urgent.`,
    context,
  );

  return { success: true, output: { brief, generatedAt: new Date().toISOString() } };
};

// check_idle_quests — scans for quests with no task activity for 7+ days
const handleCheckIdleQuests: TaskHandler = async (task) => {
  const uid = task.user_id;
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: idleQuests } = await supabase
    .from("quests")
    .select("id, title, updated_at")
    .eq("user_id", uid)
    .eq("status", "active")
    .lt("updated_at", cutoff);

  if (!idleQuests || idleQuests.length === 0) {
    return { success: true, output: { idleCount: 0 } };
  }

  // Create a requires_confirmation task for each idle quest so operator sees them in Inbox
  for (const q of idleQuests) {
    const daysSince = Math.floor((Date.now() - new Date(q.updated_at).getTime()) / (24 * 60 * 60 * 1000));
    await supabase.from("mavis_tasks").insert({
      user_id: uid,
      type: "idle_quest_alert",
      description: `Quest "${q.title}" has been idle for ${daysSince} days — review or abandon?`,
      payload: { quest_id: q.id, quest_title: q.title, days_idle: daysSince },
      status: "requires_confirmation",
    });
  }

  return { success: true, output: { idleCount: idleQuests.length, quests: idleQuests.map((q: any) => q.title) } };
};

// memory_consolidation — invokes the mavis-consolidate edge function
const handleMemoryConsolidation: TaskHandler = async (_task) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${supabaseUrl}/functions/v1/mavis-consolidate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: "{}",
  });

  if (!res.ok) return { success: false, error: `consolidate returned ${res.status}` };
  const data = await res.json();
  return { success: true, output: data };
};

// revenue_snapshot — logs a point-in-time revenue summary
const handleRevenueSnapshot: TaskHandler = async (task) => {
  const uid = task.user_id;

  const { data } = await supabase
    .from("mavis_revenue")
    .select("source, amount")
    .eq("user_id", uid);

  const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const bySource: Record<string, number> = {};
  for (const r of data ?? []) {
    bySource[r.source] = (bySource[r.source] ?? 0) + Number(r.amount);
  }

  return { success: true, output: { total, bySource, snapshotAt: new Date().toISOString() } };
};

// idle_quest_alert — already surfaces in Inbox via requires_confirmation, just ack it
const handleIdleQuestAlert: TaskHandler = async (_task) => {
  return { success: true, output: { acknowledged: true } };
};

// create_product — calls mavis-product-creator edge function
// Requires STRIPE_SECRET_KEY to publish live; stores as draft otherwise
const handleCreateProduct: TaskHandler = async (task) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${supabaseUrl}/functions/v1/mavis-product-creator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ userId: task.user_id, ...task.payload }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    return { success: false, error: data.error ?? `product-creator returned ${res.status}` };
  }

  // Auto-queue an announcement if Stripe product was created live
  if (data.stripeProductId && task.payload.title) {
    await supabase.from("mavis_tasks").insert({
      user_id: task.user_id,
      type: "send_announcement",
      description: `Announce product: "${task.payload.title}"`,
      payload: {
        title: task.payload.title,
        description: task.payload.description ?? "",
        paymentLink: data.paymentLink,
        priceCents: task.payload.price_cents ?? 2900,
      },
      status: "pending",
    });
  }

  return { success: true, output: data };
};

// send_announcement — calls mavis-announce edge function
const handleSendAnnouncement: TaskHandler = async (task) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${supabaseUrl}/functions/v1/mavis-announce`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ userId: task.user_id, ...task.payload }),
  });

  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error ?? `announce returned ${res.status}` };
  return { success: true, output: data };
};

// ─────────────────────────────────────────────────────────────
// HANDLER REGISTRY
// ─────────────────────────────────────────────────────────────

const HANDLERS: Record<string, TaskHandler> = {
  daily_brief: handleDailyBrief,
  check_idle_quests: handleCheckIdleQuests,
  memory_consolidation: handleMemoryConsolidation,
  revenue_snapshot: handleRevenueSnapshot,
  idle_quest_alert: handleIdleQuestAlert,
  create_product: handleCreateProduct,
  send_announcement: handleSendAnnouncement,
};

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const now = new Date().toISOString();
  const executed: unknown[] = [];
  const errors: unknown[] = [];

  try {
    // Fetch pending tasks that are either unscheduled or scheduled for now/past
    const { data: pendingTasks, error: fetchErr } = await supabase
      .from("mavis_tasks")
      .select("*")
      .eq("status", "pending")
      .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
      .order("created_at", { ascending: true })
      .limit(20);

    if (fetchErr) throw fetchErr;
    if (!pendingTasks || pendingTasks.length === 0) {
      return new Response(JSON.stringify({ status: "idle", message: "No pending tasks" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    for (const task of pendingTasks as Task[]) {
      await markRunning(task.id);

      const handler = HANDLERS[task.type];
      if (!handler) {
        const errMsg = `No handler registered for task type "${task.type}"`;
        await markFailed(task.id, errMsg);
        errors.push({ taskId: task.id, type: task.type, error: errMsg });
        continue;
      }

      try {
        const result = await handler(task);
        if (result.success) {
          await markComplete(task.id, result.output ?? {});
          executed.push({ taskId: task.id, type: task.type, output: result.output });
        } else {
          await markFailed(task.id, result.error ?? "handler returned success=false");
          errors.push({ taskId: task.id, type: task.type, error: result.error });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markFailed(task.id, msg);
        errors.push({ taskId: task.id, type: task.type, error: msg });
      }
    }

    return new Response(JSON.stringify({
      status: "done",
      executed: executed.length,
      errors: errors.length,
      details: { executed, errors },
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
