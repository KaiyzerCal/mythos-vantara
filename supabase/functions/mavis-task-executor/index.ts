// MAVIS Task Executor — the autonomous worker.
// Polls mavis_tasks for pending work and executes each by type.
// Scheduled via cron-job.org every 15 minutes. Can also be triggered manually.
//
// Goal tasks implement a true agentic loop:
//   plan → act → observe → re-plan → repeat until objective achieved
//
// Each cron run advances one step. Claude observes results and replans if needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
// Module-level constants — read once, reuse in all handlers
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const OPERATOR_CHAT_ID = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

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

// continuing=true means the handler re-queued itself — do NOT call markComplete
type TaskResult = { success: boolean; continuing?: boolean; output?: unknown; error?: string };
type TaskHandler = (task: Task) => Promise<TaskResult>;

// ─────────────────────────────────────────────────────────────
// GOAL STEP TYPES
// A goal plan is an ordered array of GoalStep objects.
// Each step runs in one cron tick. Results feed Claude's next decision.
// ─────────────────────────────────────────────────────────────

interface GoalStep {
  type: string;           // demand_scan | revenue_snapshot | nora_tweet | direct_action | create_product | web_search | daily_brief | system_change
  description: string;   // human-readable intent
  params: Record<string, unknown>;
  result?: unknown;
  status?: "pending" | "completed" | "failed" | "skipped";
}

interface GoalPayload {
  objective: string;
  context?: string;
  plan?: GoalStep[];
  completed_steps?: GoalStep[];
  current_step?: number;
  iteration?: number;
  started_at?: string;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Extract the flat params object from a task payload, handling both
 *  { ...fields } and { params: { ...fields } } shapes. */
function extractPayload(raw: Record<string, unknown>): Record<string, unknown> {
  return (raw.params && typeof raw.params === "object")
    ? raw.params as Record<string, unknown>
    : raw;
}

/** Fire-and-forget Telegram message to the operator. Always awaited so we
 *  know if it succeeded, but failures are swallowed (non-fatal). */
async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !OPERATOR_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* non-fatal */ }
}

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
    signal: AbortSignal.timeout(30000), // prevent indefinite hang
  });
  if (!res.ok) return "";
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

// Re-queue a goal task for the next cron run with updated payload
async function markContinue(taskId: string, updatedPayload: unknown) {
  await supabase.from("mavis_tasks").update({
    status: "pending",
    payload: updatedPayload,
  }).eq("id", taskId);
}

// ─────────────────────────────────────────────────────────────
// GOAL AGENTIC LOOP — HELPERS
// ─────────────────────────────────────────────────────────────

async function loadGoalContext(uid: string): Promise<string> {
  const [profileRes, questsRes, skillsRes, revenueRes, productsRes] = await Promise.all([
    supabase.from("profiles").select("display_name,level,rank,xp,current_form").eq("id", uid).single(),
    supabase.from("quests").select("title,status,type").eq("user_id", uid).eq("status", "active").limit(5),
    supabase.from("skills").select("name,category,tier,proficiency").eq("user_id", uid).order("proficiency", { ascending: false }).limit(8),
    supabase.from("mavis_revenue").select("amount,source").eq("user_id", uid).order("created_at", { ascending: false }).limit(10),
    supabase.from("mavis_products").select("title,status,platform,revenue_total").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
  ]);

  const profile  = profileRes.data as any;
  const quests   = (questsRes.data ?? []) as any[];
  const skills   = (skillsRes.data ?? []) as any[];
  const revenue  = (revenueRes.data ?? []) as any[];
  const products = (productsRes.data ?? []) as any[];

  const totalRevenue = revenue.reduce((s: number, r: any) => s + Number(r.amount), 0);

  const lines = [
    `OPERATOR: ${profile?.display_name ?? "Calvin"} | Level ${profile?.level} | Rank ${profile?.rank}`,
    `ACTIVE QUESTS: ${quests.map((q: any) => q.title).join(", ") || "none"}`,
    `TOP SKILLS: ${skills.map((s: any) => `${s.name}(T${s.tier},${s.proficiency}%)`).join(", ")}`,
    `TOTAL REVENUE: $${totalRevenue.toFixed(2)}`,
    `EXISTING PRODUCTS: ${products.map((p: any) => `${p.title}[${p.status},$${Number(p.revenue_total ?? 0).toFixed(0)}]`).join(", ") || "none"}`,
    `TODAY: ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`,
  ];
  return lines.join("\n");
}

// PLANNER: Claude generates an initial step-by-step plan for the goal
async function planGoal(objective: string, context: string): Promise<GoalStep[]> {
  const system = `You are MAVIS — autonomous strategic AI. You plan goal execution step by step.

Available step types (use ONLY these):
- demand_scan: scan for monetizable product opportunities (params: {})
- revenue_snapshot: check current total revenue (params: {})
- nora_tweet: post content as Nora Vale on Twitter (params: {content: "..."})
- direct_action: execute any CODEXOS app action (params: {type: "create_quest|create_task|award_xp|...", ...action_params})
- create_product: propose a product for approval — queued to Inbox (params: {title, description, audience, price_cents, category, platform})
- web_search: search the web for info (params: {query: "..."})
- daily_brief: generate a status brief (params: {})

Rules:
- Maximum 6 steps per plan
- Be specific — don't create vague steps
- For revenue goals: always start with demand_scan to find opportunities
- For revenue goals: include revenue_snapshot as final step to verify
- create_product steps will pause for operator approval before executing — plan around this
- Return ONLY valid JSON, no other text

Return this exact format:
{"steps": [{"type": "...", "description": "human-readable intent", "params": {...}}, ...]}`

  const raw = await callClaude(system, `GOAL: ${objective}\n\nCONTEXT:\n${context}`);
  try {
    const parsed = JSON.parse(raw.trim());
    return (parsed.steps ?? parsed.plan ?? []) as GoalStep[];
  } catch {
    // Try extracting JSON from response if Claude added text around it
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return (parsed.steps ?? parsed.plan ?? []) as GoalStep[];
      } catch { /* ignore */ }
    }
    return [];
  }
}

// OBSERVER: Claude evaluates step results and decides what to do next
async function observeAndDecide(
  objective: string,
  completedSteps: GoalStep[],
  remainingSteps: GoalStep[],
): Promise<{ action: "continue" | "replan" | "complete"; summary?: string; new_steps?: GoalStep[] }> {
  const system = `You are MAVIS — autonomous strategic AI evaluating goal progress.

Available step types for replanning: demand_scan, revenue_snapshot, nora_tweet, direct_action, create_product, web_search, daily_brief

Respond with ONLY valid JSON in one of these formats:
- {"action": "continue"} — proceed with the existing plan
- {"action": "complete", "summary": "..."} — goal achieved or cannot be progressed further
- {"action": "replan", "new_steps": [...]} — replace remaining steps with better ones (max 4 new steps)`;

  const completedSummary = completedSteps.map((s, i) =>
    `Step ${i + 1} [${s.type}]: ${s.description}\nResult: ${JSON.stringify(s.result).slice(0, 300)}`
  ).join("\n\n");

  const remainingSummary = remainingSteps.map((s, i) =>
    `Step ${completedSteps.length + i + 1} [${s.type}]: ${s.description}`
  ).join("\n");

  const userMsg = [
    `GOAL: ${objective}`,
    `\nCOMPLETED STEPS:\n${completedSummary || "None yet"}`,
    `\nREMAINING PLAN:\n${remainingSummary || "None — plan is complete"}`,
    `\nDecide: is the goal achieved? Should we continue, replan, or mark complete?`,
  ].join("\n");

  const raw = await callClaude(system, userMsg);
  try {
    const parsed = JSON.parse(raw.trim());
    return parsed;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* ignore */ }
    }
    return { action: "continue" };
  }
}

// STEP EXECUTOR: runs a single goal step and returns its result
async function executeGoalStep(step: GoalStep, task: Task): Promise<unknown> {
  const supabaseUrl = SUPABASE_URL;
  const serviceKey  = SERVICE_KEY;
  const uid = task.user_id;

  switch (step.type) {
    case "demand_scan": {
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-demand-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ user_id: uid }),
      });
      return await res.json();
    }

    case "revenue_snapshot": {
      const { data } = await supabase.from("mavis_revenue").select("source,amount").eq("user_id", uid);
      const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      const bySource: Record<string, number> = {};
      for (const r of data ?? []) bySource[r.source] = (bySource[r.source] ?? 0) + Number(r.amount);
      return { total, bySource };
    }

    case "nora_tweet": {
      const content = String(step.params.content ?? "").slice(0, 280);
      if (!content) return { error: "No content provided for nora_tweet" };
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-nora-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ userId: uid, content }),
      });
      return await res.json();
    }

    case "create_product": {
      // Queue for operator approval — agentic goals pause here for safety
      const { error } = await supabase.from("mavis_tasks").insert({
        user_id: uid,
        type: "create_product",
        description: `[GOAL] Product: "${step.params.title ?? "New Product"}"`,
        payload: { ...step.params, goal_task_id: task.id },
        status: "requires_confirmation",
      });
      return { queued: true, error: error?.message };
    }

    case "direct_action": {
      // Call mavis-actions with the step params as a single action
      const { type: actionType, ...actionParams } = step.params as any;
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          userId: uid,
          actions: [{ type: actionType, params: actionParams }],
        }),
      });
      return await res.json();
    }

    case "web_search": {
      const tavilyKey = Deno.env.get("TAVILY_API_KEY");
      if (!tavilyKey) return { error: "TAVILY_API_KEY not set" };
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: String(step.params.query ?? ""),
          search_depth: "basic",
          max_results: 5,
          include_answer: true,
        }),
      });
      const data = await res.json();
      return { answer: data.answer, results: (data.results ?? []).slice(0, 3).map((r: any) => ({ title: r.title, url: r.url, content: (r.content ?? "").slice(0, 300) })) };
    }

    case "daily_brief": {
      const ctx = await loadGoalContext(uid);
      const brief = await callClaude(
        "You are MAVIS. Generate a concise status brief. 3–5 bullets. Direct, sovereign tone.",
        ctx,
      );
      return { brief };
    }

    default:
      return { error: `Unknown step type: ${step.type}` };
  }
}

// ─────────────────────────────────────────────────────────────
// GOAL HANDLER — the agentic loop
// One cron tick = one step executed. Loop persists across ticks.
// ─────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 12; // safety cap — goal auto-completes after this many steps

const handleGoal: TaskHandler = async (task) => {
  const payload = task.payload as GoalPayload;

  // ── Phase 1: First run — generate plan ───────────────────
  if (!payload.plan) {
    const context = await loadGoalContext(task.user_id);
    const plan = await planGoal(payload.objective, context);

    if (!plan.length) {
      return { success: false, error: "MAVIS could not generate a plan for this goal." };
    }

    const updatedPayload: GoalPayload = {
      ...payload,
      plan,
      completed_steps: [],
      current_step: 0,
      iteration: 1,
      started_at: new Date().toISOString(),
    };

    await markContinue(task.id, updatedPayload);
    return {
      success: true,
      continuing: true,
      output: { planned: true, steps: plan.length, plan: plan.map(s => `[${s.type}] ${s.description}`) },
    };
  }

  // ── Phase 2: Subsequent runs — execute next step ─────────
  const plan           = payload.plan!;
  const completedSteps = (payload.completed_steps ?? []) as GoalStep[];
  const currentStep    = payload.current_step ?? 0;
  const iteration      = payload.iteration ?? 1;

  // Safety cap
  if (iteration > MAX_ITERATIONS) {
    return { success: true, output: { completed: true, reason: "max_iterations_reached", steps_taken: completedSteps.length } };
  }

  // Plan exhausted — do a final observe
  if (currentStep >= plan.length) {
    const decision = await observeAndDecide(payload.objective, completedSteps, []);
    return {
      success: true,
      output: {
        completed: true,
        verdict: decision.action,
        summary: decision.summary ?? "All planned steps completed.",
        steps_taken: completedSteps.length,
      },
    };
  }

  const step = plan[currentStep];

  // Execute the current step
  let stepResult: unknown;
  let stepSuccess = true;
  try {
    stepResult = await executeGoalStep(step, task);
  } catch (err) {
    stepResult = { error: String(err) };
    stepSuccess = false;
  }

  const completedStep: GoalStep = { ...step, result: stepResult, status: stepSuccess ? "completed" : "failed" };
  const newCompletedSteps = [...completedSteps, completedStep];
  const remainingSteps    = plan.slice(currentStep + 1);

  // Observe and decide: continue / replan / complete
  const decision = await observeAndDecide(payload.objective, newCompletedSteps, remainingSteps);

  if (decision.action === "complete") {
    // Store final state then let markComplete be called by the main loop
    await supabase.from("mavis_tasks").update({
      payload: { ...payload, plan, completed_steps: newCompletedSteps, current_step: currentStep + 1 },
    }).eq("id", task.id);
    return {
      success: true,
      output: {
        completed: true,
        summary: decision.summary,
        objective: payload.objective,
        steps_taken: newCompletedSteps.length,
        last_step: step.description,
      },
    };
  }

  // Build updated plan for next tick
  let nextPlan = plan;
  if (decision.action === "replan" && decision.new_steps?.length) {
    // Replace remaining steps with Claude's updated plan
    nextPlan = [
      ...plan.slice(0, currentStep + 1),
      ...(decision.new_steps as GoalStep[]),
    ];
  }

  const updatedPayload: GoalPayload = {
    ...payload,
    plan: nextPlan,
    completed_steps: newCompletedSteps,
    current_step: currentStep + 1,
    iteration: iteration + 1,
  };

  await markContinue(task.id, updatedPayload);
  return {
    success: true,
    continuing: true,
    output: {
      step_completed: step.description,
      step_result: stepResult,
      next_step: nextPlan[currentStep + 1]?.description ?? "plan complete",
      replanned: decision.action === "replan",
    },
  };
};

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
  const res = await callFunction("mavis-consolidate", {});

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

// session_update — operator approved a post-session progression bundle from The System
const handleSessionUpdate: TaskHandler = async (task) => {
  const flat = extractPayload(task.payload as Record<string, unknown>);

  const sessionTitle  = String(flat.session_title ?? "Session");
  const proposedBy    = String(flat.proposed_by   ?? "The System");
  const xpAward       = Number(flat.xp_award      ?? 0);
  const questUpdates  = (flat.quest_updates        ?? []) as Array<{ quest_title?: string; progress_delta_pct?: number; complete?: boolean }>;
  const skillUpdates  = (flat.skill_updates        ?? []) as Array<{ skill_name?: string; proficiency_delta?: number; new_proficiency?: number }>;
  const statUpdates   = (flat.stat_updates         ?? {}) as Record<string, number>;
  const invConsumed   = (flat.inventory_consumed   ?? []) as Array<{ name?: string; quantity?: number }>;

  const applied: string[] = [];
  const skipped: string[] = [];

  // ── XP ──
  if (xpAward > 0) {
    const { data: prof } = await supabase.from("profiles").select("xp, level").eq("id", task.user_id).single();
    if (prof) {
      const newXp = (Number(prof.xp) || 0) + xpAward;
      await supabase.from("profiles").update({ xp: newXp }).eq("id", task.user_id);
      applied.push(`+${xpAward} XP`);
    }
  }

  // ── Quest progress ──
  for (const qu of questUpdates) {
    const title = qu.quest_title ?? "";
    if (!title) continue;
    const { data: rows } = await supabase
      .from("quests")
      .select("id, progress_current, progress_target")
      .eq("user_id", task.user_id)
      .ilike("title", `%${title.slice(0, 40)}%`)
      .limit(1);
    const q = rows?.[0];
    if (!q) { skipped.push(`quest:${title}`); continue; }

    if (qu.complete) {
      await supabase.from("quests").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", q.id);
      applied.push(`quest completed: ${title}`);
    } else if (qu.progress_delta_pct) {
      const target = Number(q.progress_target) || 100;
      const delta  = Math.round((qu.progress_delta_pct / 100) * target);
      const newProg = Math.min(target, Number(q.progress_current) + delta);
      await supabase.from("quests").update({ progress_current: newProg, updated_at: new Date().toISOString() }).eq("id", q.id);
      applied.push(`quest +${qu.progress_delta_pct}%: ${title}`);
    }
  }

  // ── Skill proficiency ──
  for (const su of skillUpdates) {
    const name = su.skill_name ?? "";
    if (!name) continue;
    const { data: rows } = await supabase
      .from("skills")
      .select("id, proficiency")
      .eq("user_id", task.user_id)
      .ilike("name", `%${name.slice(0, 40)}%`)
      .limit(1);
    const sk = rows?.[0];
    if (!sk) { skipped.push(`skill:${name}`); continue; }

    let newProf: number;
    if (su.new_proficiency !== undefined) {
      newProf = Math.min(100, Math.max(0, Number(su.new_proficiency)));
    } else {
      newProf = Math.min(100, (Number(sk.proficiency) || 0) + Number(su.proficiency_delta ?? 0));
    }
    await supabase.from("skills").update({ proficiency: newProf }).eq("id", sk.id);
    applied.push(`skill ${name}: ${Number(sk.proficiency)}→${newProf}%`);
  }

  // ── Stat updates (additive deltas) ──
  const statKeys = Object.keys(statUpdates);
  if (statKeys.length > 0) {
    const { data: prof } = await supabase.from("profiles").select(statKeys.join(", ")).eq("id", task.user_id).single();
    if (prof) {
      const updates: Record<string, number> = {};
      for (const key of statKeys) {
        updates[key] = (Number((prof as any)[key]) || 0) + Number(statUpdates[key]);
      }
      await supabase.from("profiles").update(updates).eq("id", task.user_id);
      applied.push(`stats: ${statKeys.map(k => `${k.replace("stat_", "").toUpperCase()}+${statUpdates[k]}`).join(", ")}`);
    }
  }

  // ── Inventory consumption ──
  for (const item of invConsumed) {
    const name = item.name ?? "";
    if (!name) continue;
    const qty  = Number(item.quantity ?? 1);
    const { data: rows } = await supabase
      .from("inventory")
      .select("id, quantity")
      .eq("user_id", task.user_id)
      .ilike("name", `%${name.slice(0, 40)}%`)
      .limit(1);
    const inv = rows?.[0];
    if (!inv) { skipped.push(`item:${name}`); continue; }
    const newQty = Math.max(0, Number(inv.quantity) - qty);
    await supabase.from("inventory").update({ quantity: newQty }).eq("id", inv.id);
    applied.push(`consumed ${qty}x ${name}`);
  }

  // ── Activity log ──
  await supabase.from("mavis_activities").insert({
    user_id: task.user_id,
    type: "session_update_applied",
    description: `${proposedBy} session applied: ${sessionTitle} — ${applied.join(" | ")}`,
    xp_earned: xpAward,
  });

  return {
    success: true,
    output: { session_title: sessionTitle, applied, skipped },
  };
};

// execute_action — operator approved a generic persona/council proposal
// Re-dispatches through mavis-actions so every CODEXOS action type is supported.
const handleExecuteAction: TaskHandler = async (task) => {
  const flat        = extractPayload(task.payload as Record<string, unknown>);
  const actionType  = String(flat.action_type ?? "");
  const actionParams = (flat.params ?? {}) as Record<string, unknown>;
  const proposedBy  = String(flat.proposed_by ?? "Persona");

  if (!actionType) return { success: false, error: "execute_action: missing action_type" };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ userId: task.user_id, actions: [{ type: actionType, params: actionParams }] }),
    signal: AbortSignal.timeout(55000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, error: `mavis-actions returned ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
  }

  await supabase.from("mavis_activities").insert({
    user_id: task.user_id,
    type: "action_executed",
    description: `${proposedBy}'s proposal executed: ${actionType}`,
    xp_earned: 0,
  });

  return { success: true, output: { action_type: actionType, proposed_by: proposedBy, result: data } };
};

// system_change — operator approved a persona/council-proposed change
// Records an authoritative vault decision entry so the approval is never lost.
const handleSystemChange: TaskHandler = async (task) => {
  const flat = extractPayload(task.payload as Record<string, unknown>);

  const title      = String(flat.title ?? "System Change");
  const proposedBy = String(flat.proposed_by ?? "Council");
  const changeType = String(flat.change_type ?? "general");
  const description = String(flat.description ?? "");
  const rationale   = String(flat.rationale ?? "");
  const priority    = String(flat.priority ?? "normal");

  const vaultContent = [
    `**Proposed by:** ${proposedBy}`,
    `**Type:** ${changeType}`,
    `**Priority:** ${priority}`,
    description ? `\n**Description:**\n${description}` : "",
    rationale   ? `\n**Rationale:**\n${rationale}` : "",
    `\n**Status:** APPROVED — ${new Date().toISOString()}`,
  ].filter(Boolean).join("\n");

  await supabase.from("mavis_vault").insert({
    user_id: task.user_id,
    title: `[APPROVED] ${title}`,
    content: vaultContent,
    category: "business",
    importance: priority === "high" ? "high" : "medium",
  });

  await supabase.from("mavis_activities").insert({
    user_id: task.user_id,
    type: "system_change_approved",
    description: `Change approved: "${title}" (proposed by ${proposedBy})`,
    xp_earned: 0,
  });

  return { success: true, output: { title, approved_by: "operator", recorded_to_vault: true } };
};

// send_outreach — operator approved a Telegram reconnect nudge from ambient-monitor
// Sends the drafted message via email (or Telegram to operator if no email on file).
const handleSendOutreach: TaskHandler = async (task) => {
  const flat        = extractPayload(task.payload as Record<string, unknown>);
  const contactName  = String(flat.contact_name  ?? "Contact");
  const message      = String(flat.message       ?? "");
  const contactEmail = String(flat.contact_email ?? "");
  const draftId      = String(flat.draft_id      ?? "");

  if (!message) return { success: false, error: "send_outreach: no message in payload" };

  let sent = false;
  let channel = "";

  if (contactEmail) {
    const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-email-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ userId: task.user_id, to: contactEmail, subject: "Reaching out", body: message, source: "outreach" }),
      signal: AbortSignal.timeout(15000),
    });
    sent = emailRes.ok;
    channel = "email";
  }

  if (!sent) {
    await sendTelegram(`✅ *Outreach Approved*\n\nSend this to *${contactName}*:\n\n_"${message}"_\n\n(No email on file — copy and send manually)`);
    sent = true;
    channel = "telegram_reminder";
  }

  // Mark draft as sent
  if (draftId) {
    await supabase.from("mavis_outreach_drafts" as any)
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", draftId)
      .catch(() => {});
  }

  await supabase.from("mavis_activities").insert({
    user_id: task.user_id,
    type: "outreach_sent",
    description: `Outreach sent to ${contactName} via ${channel}`,
    xp_earned: 0,
  }).catch(() => {});

  return { success: sent, output: { contact_name: contactName, channel, draft_id: draftId } };
};
// Requires STRIPE_SECRET_KEY to publish live; stores as draft otherwise
const handleCreateProduct: TaskHandler = async (task) => {
  const flat = extractPayload(task.payload as Record<string, unknown>);

  if (!flat.title) {
    return { success: false, error: `create_product payload is missing required field "title". Goal plan generated wrong params: ${JSON.stringify(flat).slice(0, 200)}` };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-product-creator`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ ...flat, userId: task.user_id }),
    signal: AbortSignal.timeout(30000),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    return { success: false, error: data.error ?? `product-creator returned ${res.status}` };
  }

  // Auto-queue an announcement — only if no announcement already pending/completed for this title
  if ((data.gumroadProductId || data.stripeProductId) && data.paymentLink && flat.title) {
    const { data: existing } = await supabase
      .from("mavis_tasks")
      .select("id")
      .eq("user_id", task.user_id)
      .eq("type", "send_announcement")
      .in("status", ["pending", "running", "completed"])
      .ilike("description", `%${String(flat.title).slice(0, 60)}%`)
      .limit(1);

    if (!existing || existing.length === 0) {
      await supabase.from("mavis_tasks").insert({
        user_id: task.user_id,
        type: "send_announcement",
        description: `Announce product: "${flat.title}"`,
        payload: {
          title: flat.title,
          description: flat.description ?? "",
          paymentLink: data.paymentLink,
          priceCents: flat.price_cents ?? 2900,
        },
        status: "pending",
      });
    }
  }

  return { success: true, output: data };
};

/** Shared helper: call an internal edge function with service-role auth. */
async function callFunction(name: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
}

// send_announcement — email via Resend + Nora tweet via mavis-nora-post
const handleSendAnnouncement: TaskHandler = async (task) => {
  const results: unknown[] = [];
  const emailRes = await callFunction("mavis-announce", { userId: task.user_id, ...task.payload });
  results.push({ channel: "email", ...(await emailRes.json().catch(() => ({}))) });

  const p = task.payload as { title?: string; paymentLink?: string; priceCents?: number };
  if (p.title && p.paymentLink) {
    const price = `$${((p.priceCents ?? 2900) / 100).toFixed(0)}`;
    const tweetRes = await callFunction("mavis-nora-post", {
      userId: task.user_id,
      content: `Just dropped: "${p.title}" — ${price}\n\nBuilt this for anyone who's been asking about this. Grab it here: ${p.paymentLink}`,
    });
    results.push({ channel: "twitter_nora", ...(await tweetRes.json().catch(() => ({}))) });
  }

  return { success: true, output: results };
};

// nora_tweet — Nora posts arbitrary content on Twitter/X
const handleNoraTweet: TaskHandler = async (task) => {
  const res = await callFunction("mavis-nora-post", { userId: task.user_id, ...task.payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `nora-post returned ${res.status}` };
  return { success: true, output: data };
};

// demand_scan — fires the demand detection scan
const handleDemandScan: TaskHandler = async (task) => {
  const res = await callFunction("mavis-demand-scan", { userId: task.user_id });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `demand-scan returned ${res.status}` };
  return { success: true, output: data };
};

// ─────────────────────────────────────────────────────────────
// HANDLER REGISTRY
// ─────────────────────────────────────────────────────────────

// email_reply — operator approved replying to an inbound priority email
const handleEmailReply: TaskHandler = async (task) => {
  const flat        = extractPayload(task.payload as Record<string, unknown>);
  const fromEmail   = String(flat.from_email  ?? "");
  const subject     = String(flat.subject     ?? "");
  const bodyPreview = String(flat.body_preview ?? "");
  const emailId     = String(flat.email_id    ?? "");

  if (!fromEmail) return { success: false, error: "email_reply: no from_email in payload" };

  const replyText = await callClaude(
    "You are MAVIS, a sovereign AI assistant. Draft a concise, professional reply to this email on behalf of the operator. Be warm but direct. 2-4 sentences max. Output ONLY the reply body text.",
    `From: ${fromEmail}\nSubject: ${subject}\n\nBody preview: ${bodyPreview}`,
  );

  if (!replyText) return { success: false, error: "email_reply: Claude failed to generate reply" };

  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const emailRes = await callFunction("mavis-email-send", {
    userId: task.user_id, to: fromEmail, subject: replySubject, body: replyText, source: "email_reply",
  });

  let sent = emailRes.ok;
  if (!sent) {
    // Fallback: push reply draft to Telegram so operator can copy-paste
    await sendTelegram(`📧 *Email Reply Ready*\nTo: ${fromEmail}\nSubject: ${replySubject}\n\n_${replyText}_\n\n(Email send failed — copy and send manually)`);
    sent = true; // Telegram fallback counts as delivered
  }

  // Only mark processed when we have confirmation it was handled
  if (emailId && sent) {
    await supabase.from("mavis_inbound_emails").update({ processed: true }).eq("id", emailId).catch(() => {});
  }

  return { success: sent, output: { to: fromEmail, subject: replySubject, reply_preview: replyText.slice(0, 100) } };
};

// standing_order — executes a standing order template's instructions via Claude,
// parses any :::ACTION{...}::: tags from the response, and dispatches them to
// mavis-actions. Records execution in mavis_so_executions.
const handleStandingOrder: TaskHandler = async (task) => {
  const flat = extractPayload(task.payload as Record<string, unknown>);
  const instructions = String(flat.instructions ?? task.description ?? "No instructions provided");
  const templateId   = flat.template_id   ? String(flat.template_id)   : null;
  const templateSlug = flat.template_slug ? String(flat.template_slug) : null;
  const triggeredBy  = flat.triggered_by  ? String(flat.triggered_by)  : "scheduler";

  // Open an execution record so the UI can show it
  const { data: execRow } = await supabase
    .from("mavis_so_executions")
    .insert({
      template_id:   templateId,
      template_slug: templateSlug,
      status:        "running",
      started_at:    new Date().toISOString(),
      triggered_by:  triggeredBy,
      turns_used:    0,
    })
    .select("id")
    .single()
    .catch(() => ({ data: null }));

  const execId: string | null = (execRow as any)?.id ?? null;

  const finalize = async (status: "completed" | "failed", result: string, errorMsg?: string) => {
    if (execId) {
      await supabase.from("mavis_so_executions").update({
        status,
        result:          result.slice(0, 1000),
        error_message:   errorMsg ?? null,
        completed_at:    new Date().toISOString(),
        turns_used:      1,
      }).eq("id", execId);
    }
    if (templateId) {
      const updates: Record<string, unknown> = { last_used_at: new Date().toISOString() };
      if (status === "completed") updates.success_count = supabase.rpc ? undefined : undefined; // incremented below
      // Use raw SQL increment via RPC-less update — fetch current then +1
      const { data: tpl } = await supabase
        .from("standing_order_templates")
        .select("usage_count, success_count")
        .eq("id", templateId)
        .single()
        .catch(() => ({ data: null }));
      if (tpl) {
        updates.usage_count    = ((tpl as any).usage_count   ?? 0) + 1;
        if (status === "completed") updates.success_count = ((tpl as any).success_count ?? 0) + 1;
      }
      await supabase.from("standing_order_templates").update(updates).eq("id", templateId);
    }
  };

  try {
    const context = await loadGoalContext(task.user_id);

    const response = await callClaude(
      `You are MAVIS executing a standing order for the operator.
Read the instructions carefully. Execute the procedure by emitting :::ACTION{"type":"...","params":{...}}::: tags for any CODEXOS operations needed.
After emitting action tags, briefly confirm what you did.

OPERATOR CONTEXT:
${context}`,
      `STANDING ORDER — ${templateSlug ?? "procedure"}:\n\n${instructions}`,
    );

    // Parse :::ACTION{...}::: tags and dispatch each to mavis-actions
    const ACTION_REGEX = /:::ACTION(\{[\s\S]*?\}):::/g;
    const actionMatches = [...response.matchAll(ACTION_REGEX)];
    let actionsDispatched = 0;

    if (actionMatches.length > 0) {
      const actions = actionMatches
        .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
        .filter(Boolean);

      if (actions.length > 0) {
        await fetch(`${SUPABASE_URL}/functions/v1/mavis-actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ actions, userId: task.user_id }),
          signal: AbortSignal.timeout(30000),
        });
        actionsDispatched = actions.length;
      }
    }

    const summary = `${actionsDispatched} action(s) executed. ${response.replace(ACTION_REGEX, "").trim().slice(0, 300)}`;
    await finalize("completed", summary);
    return { success: true, output: { summary, actionsDispatched, template_slug: templateSlug } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalize("failed", "", msg);
    return { success: false, error: msg };
  }
};

// client_welcome_sequence — fires when a client pays a Stripe invoice.
// Two separate tasks are queued by mavis-stripe-webhook with staggered scheduled_at:
//   phase="thankyou"   → T+4 min: warm thank-you email
//   phase="onboarding" → T+7 min: next-steps email with Calendly booking link
const handleClientWelcomeSequence: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const phase         = String(p.phase ?? "thankyou");
  const email         = String(p.customer_email ?? "");
  const fullName      = String(p.customer_name  ?? "there");
  const firstName     = fullName.split(/\s+/)[0] || fullName;
  const amountPaid    = Number(p.amount_paid ?? 0);
  const calendlyUrl   = Deno.env.get("OPERATOR_CALENDLY_URL") ?? "";

  if (!email) return { success: false, error: "client_welcome_sequence: no customer_email in payload" };

  const amountStr = amountPaid > 0 ? `$${amountPaid.toFixed(2)}` : "your invoice";

  let subject: string;
  let body: string;

  if (phase === "thankyou") {
    subject = "Thank you & welcome aboard";
    body = `Hi ${firstName},
<br><br>
Thanks for taking care of ${amountStr} — I really appreciate it.
<br><br>
I'm looking forward to working together. I'll be sending over onboarding details in just a moment so we can hit the ground running.
<br><br>
Talk soon!`;
  } else {
    const calendlyLine = calendlyUrl
      ? `<a href="${calendlyUrl}">Do you mind booking a slot here?</a><br><br>Ideally in the next 72 hours, but I'm flexible — let me know what works for you.`
      : `Reply to this email and we'll find a time that works for you.`;

    subject = "Next steps — let's book your onboarding call";
    body = `Hi ${firstName},
<br><br>
Just following up on my last email. Our next step is a quick onboarding call.
<br><br>
These usually take about 20 minutes via screenshare — it lets us go over timelines, expectations, any 2FA or access logistics, and answer any last-minute questions before we kick off.
<br><br>
${calendlyLine}
<br><br>
Thank you,<br>
Calvin`;
  }

  const res = await callFunction("mavis-email-send", {
    userId:  task.user_id,
    to:      email,
    subject,
    body,
    source:  `client_welcome_${phase}`,
  });

  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { success: false, error: String((d as any).error ?? `email-send returned ${res.status}`) };
  }

  await sendTelegram(
    `📧 *Client Welcome — ${phase}*\nTo: ${email} (${fullName})\nSubject: ${subject}`
  );

  return { success: true, output: { phase, to: email, subject } };
};

// nora_content_machine — end-to-end Nora Vale content pipeline.
// Phase 1 (no fal_request_id): research topic → write script + captions → submit to fal.ai SadTalker → markContinue
// Phase 2 (fal_request_id set): poll fal.ai → when video ready, post to Twitter / LinkedIn / TikTok → markComplete
// Falls back to text-only posting when NORA_AVATAR_IMAGE_URL is not configured.
const handleNoraContentMachine: TaskHandler = async (task) => {
  const p = task.payload as Record<string, unknown>;
  const topic = String(p.topic ?? "AI automation for founders");
  const platforms = Array.isArray(p.platforms)
    ? (p.platforms as string[])
    : ["twitter", "linkedin", "tiktok"];
  const avatarImageUrl = String(
    p.avatar_image_url ?? Deno.env.get("NORA_AVATAR_IMAGE_URL") ?? ""
  );
  const voiceId = String(
    p.voice_id ?? Deno.env.get("NORA_VOICE_ID") ?? "JBFqnCBsd6RMkjVDRZzb"
  );

  // ── PHASE 2: poll fal.ai for video completion ────────────────
  if (p.fal_request_id) {
    const pollAttempts = Number(p.poll_attempts ?? 0) + 1;
    if (pollAttempts > 8) {
      return { success: false, error: "fal.ai video generation timed out after 8 poll attempts (~2 hours)" };
    }

    const pollRes = await callFunction("mavis-avatar-video", {
      action: "poll",
      request_id: String(p.fal_request_id),
    });
    const pollData = await pollRes.json().catch(() => ({})) as Record<string, unknown>;

    if (!pollRes.ok || pollData.error) {
      return { success: false, error: String(pollData.error ?? `avatar-video poll returned ${pollRes.status}`) };
    }

    if (pollData.status !== "complete") {
      await markContinue(task.id, { ...p, poll_attempts: pollAttempts });
      return { success: true, continuing: true, output: { phase: "polling", attempt: pollAttempts } };
    }

    // Video ready — dispatch to all requested platforms
    const videoUrl = String(pollData.url);
    const captions = (p.captions ?? {}) as Record<string, string>;
    const results: Record<string, unknown> = { video_url: videoUrl };

    if (platforms.includes("twitter")) {
      const r = await callFunction("mavis-nora-post", {
        userId: task.user_id,
        content: captions.twitter ?? topic,
      });
      results.twitter = r.ok ? "posted" : `failed:${r.status}`;
    }

    if (platforms.includes("linkedin")) {
      const r = await callFunction("mavis-nora-linkedin", {
        user_id: task.user_id,
        content: captions.linkedin ?? captions.twitter ?? topic,
      });
      results.linkedin = r.ok ? "posted" : `failed:${r.status}`;
    }

    if (platforms.includes("tiktok")) {
      const r = await callFunction("mavis-nora-tiktok", {
        user_id: task.user_id,
        content: captions.tiktok ?? topic,
        video_url: videoUrl,
      });
      results.tiktok = r.ok ? "posted" : `failed:${r.status}`;
    }

    if (platforms.includes("instagram")) {
      const r = await callFunction("mavis-nora-instagram", {
        user_id: task.user_id,
        image_url: videoUrl,
        caption: captions.instagram,
      });
      results.instagram = r.ok ? "posted" : `failed:${r.status}`;
    }

    await sendTelegram(
      `🎬 *Nora Content Machine complete*\nTopic: ${topic}\n` +
      Object.entries(results)
        .filter(([k]) => k !== "video_url")
        .map(([k, v]) => `• ${k}: ${v}`)
        .join("\n")
    );

    return { success: true, output: results };
  }

  // ── PHASE 1: research → write → submit ──────────────────────

  // Optional web research via Tavily
  let researchContext = "";
  const tavilyKey = Deno.env.get("TAVILY_API_KEY");
  if (tavilyKey) {
    try {
      const sr = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, query: topic, max_results: 4, search_depth: "basic" }),
        signal: AbortSignal.timeout(10000),
      });
      if (sr.ok) {
        const sd = await sr.json() as Record<string, unknown>;
        researchContext = ((sd.results ?? []) as Array<{ title: string; content: string }>)
          .slice(0, 4)
          .map((r) => `• ${r.title}: ${String(r.content).slice(0, 200)}`)
          .join("\n");
      }
    } catch { /* research is non-critical */ }
  }

  // Write script + platform captions
  const rawContent = await callClaude(
    `You are Nora Vale — tech-forward business strategist and AI automation expert. Direct, insight-dense, no fluff. First person. No stage directions.

Output ONLY a JSON object (no markdown, no preamble):
{
  "script": "...",      // 60-90 second spoken script — pure speech
  "twitter": "...",    // 240 chars max. Strong hook + insight. 2-3 hashtags.
  "linkedin": "...",   // 300-500 chars. Story opener, insight, CTA.
  "tiktok": "...",     // 130 chars max. High energy. 3-5 hashtags.
  "instagram": "..."   // 200 chars. Visual-forward. 5-7 hashtags.
}`,
    `Topic: ${topic}${researchContext ? `\n\nResearch:\n${researchContext}` : ""}\n\nOutput only the JSON object.`,
  );

  let script = "";
  let captions: Record<string, string> = {};
  try {
    const m = rawContent.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      script = String(parsed.script ?? "");
      captions = {
        twitter:   String(parsed.twitter   ?? ""),
        linkedin:  String(parsed.linkedin  ?? ""),
        tiktok:    String(parsed.tiktok    ?? ""),
        instagram: String(parsed.instagram ?? ""),
      };
    }
  } catch { /* fall back */ }

  if (!script) {
    script = rawContent.slice(0, 800);
    captions = {
      twitter:   `${topic} — ${script.slice(0, 180)} #AI #automation`,
      linkedin:  script.slice(0, 450),
      tiktok:    `${topic} #AI #automation #founder`,
      instagram: `${topic} #AI #business #founder`,
    };
  }

  // If no avatar image configured — post text-only and finish
  if (!avatarImageUrl) {
    const results: Record<string, unknown> = { mode: "text-only" };

    if (platforms.includes("twitter")) {
      const r = await callFunction("mavis-nora-post", { userId: task.user_id, content: captions.twitter });
      results.twitter = r.ok ? "posted" : `failed:${r.status}`;
    }
    if (platforms.includes("linkedin")) {
      const r = await callFunction("mavis-nora-linkedin", { user_id: task.user_id, content: captions.linkedin });
      results.linkedin = r.ok ? "posted" : `failed:${r.status}`;
    }
    if (platforms.includes("tiktok")) {
      results.tiktok = "skipped — no video (set NORA_AVATAR_IMAGE_URL to enable)";
    }

    await sendTelegram(
      `📝 *Nora Content (text-only)*\nTopic: ${topic}\n` +
      Object.entries(results).map(([k, v]) => `• ${k}: ${v}`).join("\n") +
      `\n\n_Set NORA_AVATAR_IMAGE_URL to enable avatar video._`
    );
    return { success: true, output: results };
  }

  // Submit avatar video job to fal.ai via mavis-avatar-video
  const submitRes = await callFunction("mavis-avatar-video", {
    source_image_url: avatarImageUrl,
    text: script,
    voice_id: voiceId,
    still_mode: false,
    use_enhancer: true,
  });
  const submitData = await submitRes.json().catch(() => ({})) as Record<string, unknown>;

  if (!submitRes.ok || submitData.error) {
    // fal.ai failed — fall back to text-only immediately
    const results: Record<string, unknown> = { mode: "text-only-fallback", reason: String(submitData.error ?? `avatar-video returned ${submitRes.status}`) };
    if (platforms.includes("twitter")) {
      const r = await callFunction("mavis-nora-post", { userId: task.user_id, content: captions.twitter });
      results.twitter = r.ok ? "posted" : `failed:${r.status}`;
    }
    if (platforms.includes("linkedin")) {
      const r = await callFunction("mavis-nora-linkedin", { user_id: task.user_id, content: captions.linkedin });
      results.linkedin = r.ok ? "posted" : `failed:${r.status}`;
    }
    return { success: true, output: results };
  }

  // Video submitted — queue Phase 2 for next cron cycle
  await markContinue(task.id, {
    ...p,
    fal_request_id: String(submitData.request_id),
    script,
    captions,
    poll_attempts: 0,
  });

  return {
    success: true,
    continuing: true,
    output: { phase: "video_submitted", request_id: submitData.request_id, topic },
  };
};

// google_agent — delegates any Google API operation to mavis-google-agent.
// Useful for async operations like bulk calendar sync, Drive uploads, Gmail sends.
// Payload: { action: "...", ...params }
const handleGoogleAgent: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const action = String(p.action ?? "");
  if (!action) return { success: false, error: "google_agent task missing 'action' in payload" };

  const res = await callFunction("mavis-google-agent", {
    userId: task.user_id,
    ...p,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (data as any).error ?? `mavis-google-agent returned ${res.status}`;
    // 503 means Google not connected — not a fatal task failure, mark as failed with clear message
    return { success: false, error: errMsg };
  }
  return { success: true, output: data };
};

// Generic agent task handler factory — for slack, notion, airtable, twilio, calendly
function makeAgentHandler(fnName: string): TaskHandler {
  return async (task) => {
    const p = extractPayload(task.payload as Record<string, unknown>);
    const action = String(p.action ?? "");
    if (!action) return { success: false, error: `${fnName} task missing 'action' in payload` };

    const res  = await callFunction(fnName, { userId: task.user_id, ...p });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: (data as any).error ?? `${fnName} returned ${res.status}` };
    return { success: true, output: data };
  };
}

// weekly_reflection — MAVIS self-improvement loop
const handleWeeklyReflection: TaskHandler = async (task) => {
  const res  = await callFunction("mavis-reflection-agent", { userId: task.user_id, action: "run_reflection" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `reflection-agent returned ${res.status}` };
  return { success: true, output: { summary: (data as any).report?.slice(0, 500) } };
};

// social_content_pipeline — read ideas from Google Sheets, generate posts,
// route to the right platform, update sheet with status
const handleSocialContentPipeline: TaskHandler = async (task) => {
  const p             = extractPayload(task.payload as Record<string, unknown>);
  const spreadsheetId = String(p.spreadsheet_id ?? "");
  const sheetName     = String(p.sheet_name ?? "Sheet1");
  const ideaCol       = String(p.idea_column ?? "Idea");
  const platformCol   = String(p.platform_column ?? "Platform");
  const statusCol     = String(p.status_column ?? "Status");
  const limitN        = Math.min(Number(p.limit ?? 10), 25);
  const channelMap    = (p.channel_map ?? {}) as Record<string, string>; // { "Discord": "123456789" }

  if (!spreadsheetId) return { success: false, error: "spreadsheet_id required" };

  // Step 1: Read all rows from the sheet
  const sheetsRes = await callFunction("mavis-sheets-agent", {
    userId:         task.user_id,
    action:         "search_rows",
    spreadsheet_id: spreadsheetId,
    sheet_name:     sheetName,
    column:         statusCol,
    value:          "",            // empty status = not yet posted
    limit:          limitN,
  });
  const sheetsData = await sheetsRes.json().catch(() => ({}));

  let rows: any[] = (sheetsData as any).rows ?? [];
  // Also include rows that literally don't have a Status column filled
  if (!rows.length) {
    // Fall back: get all rows, filter client-side
    const allRes = await callFunction("mavis-sheets-agent", {
      userId:         task.user_id,
      action:         "get_range",
      spreadsheet_id: spreadsheetId,
      range:          `${sheetName}!A1:Z`,
    });
    const allData = await allRes.json().catch(() => ({}));
    const values: string[][] = (allData as any).values ?? [];
    if (values.length > 1) {
      const headers = values[0];
      const statusIdx  = headers.findIndex((h: string) => h.toLowerCase() === statusCol.toLowerCase());
      const platformIdx = headers.findIndex((h: string) => h.toLowerCase() === platformCol.toLowerCase());
      const ideaIdx    = headers.findIndex((h: string) => h.toLowerCase() === ideaCol.toLowerCase());
      rows = values.slice(1)
        .map((row, i) => {
          const obj: Record<string, string> = { _row_number: String(i + 2) };
          headers.forEach((h: string, hi: number) => { if (h) obj[h] = row[hi] ?? ""; });
          return obj;
        })
        .filter(row => !row[statusCol] || row[statusCol].trim() === "")
        .filter(row => row[platformCol] && row[ideaCol])
        .slice(0, limitN);
    }
  }

  if (!rows.length) return { success: true, output: { message: "No unposted rows found", processed: 0 } };

  // Platform → agent routing
  const PLATFORM_ROUTES: Record<string, { fn: string; actionKey: string; textKey: string; extraParams?: (row: any) => Record<string, unknown> }> = {
    twitter:   { fn: "mavis-twitter-agent",  actionKey: "post_tweet",    textKey: "text" },
    x:         { fn: "mavis-twitter-agent",  actionKey: "post_tweet",    textKey: "text" },
    discord:   { fn: "mavis-discord-agent",  actionKey: "send_message",  textKey: "content",
                 extraParams: (row) => ({ channel_id: channelMap[row[platformCol]] ?? channelMap.discord ?? "" }) },
    slack:     { fn: "mavis-slack-agent",    actionKey: "send_message",  textKey: "text",
                 extraParams: (row) => ({ channel: channelMap[row[platformCol]] ?? channelMap.slack ?? "#general" }) },
    beehiiv:   { fn: "mavis-beehiiv-agent",  actionKey: "create_post",   textKey: "content",
                 extraParams: (row) => ({ title: row[ideaCol]?.slice(0, 80) }) },
    newsletter:{ fn: "mavis-beehiiv-agent",  actionKey: "create_post",   textKey: "content",
                 extraParams: (row) => ({ title: row[ideaCol]?.slice(0, 80) }) },
    telegram:  { fn: "mavis-telegram-agent", actionKey: "send_message",  textKey: "text" },
  };

  const results: any[] = [];
  let posted = 0;

  for (const row of rows) {
    const platform = String(row[platformCol] ?? "").toLowerCase().trim();
    const idea     = String(row[ideaCol] ?? "").trim();
    const rowNum   = Number(row._row_number ?? 2);

    if (!platform || !idea) continue;

    // Step 2: Generate platform-specific post with Claude
    let generatedText = "";
    const claudeRes = await callFunction("mavis-chat", {
      userId:   task.user_id,
      messages: [{
        role:    "user",
        content: `Write a ${platform} post based on this idea: "${idea}". Platform: ${platform}. Keep it engaging and concise. Return ONLY the post text, nothing else.${platform === "twitter" || platform === "x" ? " Max 280 characters." : ""}`,
      }],
    }).catch(() => null);

    if (claudeRes) {
      const chatData = await claudeRes.json().catch(() => ({}));
      generatedText = (chatData as any).reply ?? (chatData as any).message ?? (chatData as any).text ?? "";
    }

    if (!generatedText) {
      // Fallback: use idea directly
      generatedText = idea;
    }

    // Step 3: Route to platform
    const route = PLATFORM_ROUTES[platform];
    let postResult: any = null;
    let postError: string | null = null;

    if (route) {
      const extraP = route.extraParams ? route.extraParams(row) : {};
      const postRes = await callFunction(route.fn, {
        userId: task.user_id,
        action: route.actionKey,
        [route.textKey]: generatedText,
        ...extraP,
      });
      const postData = await postRes.json().catch(() => ({}));
      if (!postRes.ok) {
        postError = (postData as any).error ?? `${route.fn} returned ${postRes.status}`;
      } else {
        postResult = postData;
        posted++;
      }
    } else {
      postError = `Unknown platform: ${platform}. Add to channel_map or extend PLATFORM_ROUTES.`;
    }

    // Step 4: Update sheet row with status
    const status    = postError ? `Error: ${postError.slice(0, 50)}` : "Posted";
    const timestamp = new Date().toISOString();

    await callFunction("mavis-sheets-agent", {
      userId:         task.user_id,
      action:         "update_row",
      spreadsheet_id: spreadsheetId,
      sheet_name:     sheetName,
      row_number:     rowNum,
      values:         { ...row, [statusCol]: status, Generated_Post: generatedText, Posted_At: timestamp },
    }).catch(() => {});

    results.push({ row: rowNum, platform, idea: idea.slice(0, 60), status, post_id: postResult?.tweet_id ?? postResult?.id ?? null, error: postError });
  }

  // Telegram summary
  if (BOT_TOKEN && OPERATOR_CHAT_ID) {
    const lines = results.map(r => `• ${r.platform} (row ${r.row}): ${r.status}`).join("\n");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    OPERATOR_CHAT_ID,
        text:       `📣 *Social Content Pipeline*\n${posted}/${results.length} posted\n\n${lines}`,
        parse_mode: "Markdown",
      }),
    }).catch(() => {});
  }

  return { success: true, output: { processed: results.length, posted, results } };
};

// youtube_summary — summarize a YouTube video and deliver via Telegram
const handleYoutubeSummary: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const url = String(p.url ?? p.video_id ?? "");
  if (!url) return { success: false, error: "url or video_id required" };

  const res = await callFunction("mavis-youtube-agent", {
    userId:   task.user_id,
    action:   "summarize_video",
    url,
    language: p.language ?? "en",
    model:    p.model,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `youtube-agent returned ${res.status}` };

  const d = data as any;
  if (BOT_TOKEN && OPERATOR_CHAT_ID) {
    const header = `🎬 *${(d.title ?? "Video").slice(0, 100)}*\n${d.channel ? `📺 ${d.channel} · ` : ""}⏱ ~${d.reading_time_minutes ?? "?"}m read\n[Watch on YouTube](${d.url})\n\n`;
    const msg    = (header + (d.summary ?? "")).slice(0, 4000);
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:                  OPERATOR_CHAT_ID,
        text:                     msg,
        parse_mode:               "Markdown",
        disable_web_page_preview: false,
      }),
    }).catch(() => {});
  }

  return { success: true, output: { title: d.title, stored_in_memory: d.stored_in_memory } };
};

// content_digest — scrape one or more source sites and send a summary via Telegram
const handleContentDigest: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);

  // Accept single source or array of sources
  const sources: Array<{ url: string; link_pattern?: string; name?: string }> =
    Array.isArray(p.sources)
      ? (p.sources as any[]).map(s => typeof s === "string" ? { url: s } : s)
      : [{ url: String(p.url ?? ""), link_pattern: p.link_pattern as string | undefined, name: p.name as string | undefined }];

  const limit        = Math.min(Number(p.limit ?? 5), 10);
  const allItems: any[] = [];

  for (const source of sources) {
    if (!source.url) continue;
    const res = await callFunction("mavis-firecrawl-agent", {
      userId:         task.user_id,
      action:         "digest",
      url:            source.url,
      link_pattern:   source.link_pattern ?? "",
      limit,
      summary_prompt: p.summary_prompt,
    });
    const data = await res.json().catch(() => ({}));
    if ((data as any).items) {
      ((data as any).items as any[]).forEach(item =>
        allItems.push({ ...item, source_name: source.name ?? source.url }),
      );
    }
  }

  // Telegram digest
  if (allItems.length > 0 && BOT_TOKEN && OPERATOR_CHAT_ID) {
    const label = String(p.label ?? "Content Digest");
    const header = `📰 *${label}* — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}\n${allItems.length} article${allItems.length !== 1 ? "s" : ""} summarized\n\n`;
    const body   = allItems.slice(0, 6).map((item: any, i: number) =>
      `*${i + 1}. ${(item.title ?? "Untitled").slice(0, 80)}*\n${(item.summary ?? "").slice(0, 220)}...\n[Read →](${item.url})`,
    ).join("\n\n");

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:                 OPERATOR_CHAT_ID,
        text:                    (header + body).slice(0, 4000),
        parse_mode:              "Markdown",
        disable_web_page_preview: true,
      }),
    }).catch(() => {});
  }

  return { success: true, output: { items: allItems, count: allItems.length } };
};

// email_triage — runs Gmail auto-responder pipeline (assess + draft replies)
const handleEmailTriage: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const res = await callFunction("mavis-google-agent", {
    userId:        task.user_id,
    action:        "triage_inbox",
    limit:         p.limit ?? 10,
    draft_replies: p.draft_replies !== false,
    mark_read:     p.mark_read ?? false,
    tone:          p.tone ?? "professional",
    signature:     p.signature ?? "",
    system_prompt: p.system_prompt ?? "",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `google-agent returned ${res.status}` };

  const result = data as any;
  // Send Telegram summary if drafts were created
  if (result.drafts_created > 0 && BOT_TOKEN && OPERATOR_CHAT_ID) {
    const lines = (result.results ?? [])
      .filter((r: any) => r.draft_id)
      .map((r: any) => `• ${r.from?.split("<")[0].trim() || r.from} — ${r.subject}`)
      .slice(0, 5);
    const msg = `📬 *Email Triage*\n${result.triaged} checked · ${result.drafts_created} draft${result.drafts_created !== 1 ? "s" : ""} created\n\n${lines.join("\n")}`;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return { success: true, output: { triaged: result.triaged, drafts_created: result.drafts_created } };
};

// review_monitor — poll GMB for new reviews → AI reply → log to Sheets → post reply → Telegram summary
const handleReviewMonitor: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const res = await callFunction("mavis-gmb-agent", {
    userId: task.user_id,
    action: "monitor_reviews",
    ...p,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `mavis-gmb-agent returned ${res.status}` };

  const result = data as any;
  if (BOT_TOKEN && OPERATOR_CHAT_ID) {
    const lines = (result.results ?? [])
      .filter((r: any) => !r.error)
      .map((r: any) => `• *${r.reviewer}* (${r.stars ?? r.star_rating}) — ${String(r.comment ?? "").slice(0, 80)}`)
      .slice(0, 5);
    const msg = [
      `⭐ *GMB Review Monitor*`,
      `${result.new_since_last_check ?? 0} new · ${result.replied ?? 0} replied · avg ${result.average_rating ?? "?"}★`,
      result.sheets_logged > 0 ? `📊 ${result.sheets_logged} row${result.sheets_logged !== 1 ? "s" : ""} logged to Sheets` : "",
      lines.length ? `\n${lines.join("\n")}` : "",
    ].filter(Boolean).join("\n");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return { success: true, output: { processed: result.processed, new_reviews: result.new_since_last_check, replied: result.replied } };
};

// email_watch — poll for new emails since last check and create dual AI drafts for each
const handleEmailWatch: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const res = await callFunction("mavis-google-agent", {
    userId:      task.user_id,
    action:      "watch_new_emails",
    max_results: p.max_results ?? 5,
    model_a:     p.model_a ?? "claude-haiku-4-5-20251001",
    model_b:     p.model_b ?? "claude-sonnet-4-6",
    prompt_a:    p.prompt_a ?? "",
    prompt_b:    p.prompt_b ?? "",
    signature:   p.signature ?? "",
    state_key:   p.state_key ?? "email_watch_state",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `google-agent returned ${res.status}` };

  const result = data as any;
  if (result.drafts_created > 0 && BOT_TOKEN && OPERATOR_CHAT_ID) {
    const lines = (result.results ?? [])
      .filter((r: any) => r.draft_id)
      .map((r: any) => `• ${r.from?.split("<")[0].trim() || r.from} — ${r.subject}`)
      .slice(0, 5);
    const msg = [
      `📬 *Inbox Watch*`,
      `${result.processed} new email${result.processed !== 1 ? "s" : ""} · ${result.drafts_created} dual draft${result.drafts_created !== 1 ? "s" : ""} created`,
      ``,
      lines.join("\n"),
    ].join("\n");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return { success: true, output: { processed: result.processed, drafts_created: result.drafts_created } };
};

// daily_comic — scrape today's GoComics strip → Claude vision translate dialogue → post to Discord/Telegram
const handleDailyComic: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const res = await callFunction("mavis-comic-agent", {
    userId:          task.user_id,
    action:          "daily_comic_post",
    strip:           p.strip           ?? "calvinandhobbes",
    target_language: p.target_language ?? "Korean",
    discord_webhook: p.discord_webhook ?? "",
    telegram:        p.telegram        ?? true,
    telegram_chat_id: p.telegram_chat_id ?? "",
    model:           p.model           ?? "claude-haiku-4-5-20251001",
  });
  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok) return { success: false, error: data.error ?? `comic-agent returned ${res.status}` };

  if (BOT_TOKEN && OPERATOR_CHAT && !data.telegram_posted) {
    // Telegram wasn't configured in the agent or failed — send a fallback notification
    const msg = [
      `🗞️ *Daily Comic posted* — ${data.strip === "calvinandhobbes" ? "Calvin & Hobbes" : data.strip}`,
      `📅 ${data.date}`,
      data.discord_posted ? `✅ Discord posted` : `⚠️ Discord skipped (no webhook)`,
      data.image_url ? `🖼 ${data.image_url}` : "",
    ].filter(Boolean).join("\n");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return { success: true, output: { date: data.date, strip: data.strip, discord_posted: data.discord_posted, telegram_posted: data.telegram_posted } };
};

// daily_story — generate children's story → OpenAI TTS audio → fal.ai illustration → post all three to Telegram
const handleDailyStory: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const res = await callFunction("mavis-story-agent", {
    userId:           task.user_id,
    action:           "daily_story_post",
    topic:            p.topic            ?? "",
    language:         p.language         ?? "English",
    voice:            p.voice            ?? "alloy",
    telegram_chat_id: p.telegram_chat_id ?? "",
    model:            p.model            ?? "claude-haiku-4-5-20251001",
  });
  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok) return { success: false, error: data.error ?? `story-agent returned ${res.status}` };

  if (BOT_TOKEN && OPERATOR_CHAT_ID) {
    const parts = [
      `📖 *Daily Children's Story*`,
      data.text_sent  ? "✅ Text sent"    : "❌ Text failed",
      data.audio_sent ? "🔊 Audio sent"   : "⚠️ Audio skipped",
      data.image_sent ? "🖼️ Image sent"  : "⚠️ Image skipped",
      ``,
      `"${String(data.story ?? "").slice(0, 200)}…"`,
    ];
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: parts.join("\n"), parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return {
    success: true,
    output: {
      text_sent:  data.text_sent,
      audio_sent: data.audio_sent,
      image_sent: data.image_sent,
      story:      String(data.story ?? "").slice(0, 200),
    },
  };
};

// hashtag_tweet — pick random hashtag → AI-generated tweet → log to Airtable → optionally post → Telegram notification
const handleHashtagTweet: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const res = await callFunction("mavis-twitter-agent", {
    action:    "generate_tweet",
    hashtags:  p.hashtags ?? ["#ai"],
    topic:     p.topic ?? "",
    max_chars: p.max_chars ?? 280,
  });
  const genData = await res.json().catch(() => ({})) as any;
  if (!res.ok) return { success: false, error: genData.error ?? `twitter-agent returned ${res.status}` };

  const { hashtag, tweet } = genData;

  // Log to Airtable
  let airtableRecordId: string | null = null;
  if (p.airtable_base_id) {
    const atRes = await callFunction("mavis-airtable-agent", {
      userId:  task.user_id,
      action:  "create_record",
      base_id: p.airtable_base_id,
      table:   p.airtable_table ?? "Tweets",
      fields: {
        Hashtag:   hashtag,
        Content:   tweet,
        Generated: new Date().toISOString().split("T")[0],
        Status:    p.auto_post ? "Posted" : "Draft",
      },
    });
    const atData = await atRes.json().catch(() => ({})) as any;
    airtableRecordId = atData.id ?? atData.record?.id ?? null;
  }

  // Optionally post to Twitter
  let tweetId: string | null = null;
  if (p.auto_post) {
    const postRes = await callFunction("mavis-twitter-agent", { action: "post_tweet", text: tweet });
    const postData = await postRes.json().catch(() => ({})) as any;
    tweetId = postData.tweet_id ?? null;
  }

  if (BOT_TOKEN && OPERATOR_CHAT_ID) {
    const status = tweetId ? "✅ Posted" : "📝 Draft saved";
    const msg = [
      `🐦 *Hashtag Tweet*`,
      `${status} · ${hashtag}`,
      ``,
      `"${tweet}"`,
      airtableRecordId ? `📊 Logged to Airtable (${airtableRecordId})` : "",
    ].filter(Boolean).join("\n");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return { success: true, output: { hashtag, tweet, tweet_id: tweetId, airtable_record_id: airtableRecordId } };
};

// instagram_monitor — poll recent media for new comments → AI reply → post as @mention reply → Telegram summary
const handleInstagramMonitor: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const res = await callFunction("mavis-instagram-agent", {
    userId:             task.user_id,
    action:             "monitor_comments",
    business_name:      p.business_name ?? "our brand",
    reply_signature:    p.reply_signature ?? "",
    media_limit:        p.media_limit ?? 5,
    comments_per_media: p.comments_per_media ?? 50,
    auto_reply:         p.auto_reply ?? true,
    skip_replies:       p.skip_replies ?? true,
    state_key:          p.state_key ?? "ig_comment_watch_state",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `instagram-agent returned ${res.status}` };

  const result = data as any;
  if (result.replied > 0 && BOT_TOKEN && OPERATOR_CHAT_ID) {
    const lines = (result.results ?? [])
      .filter((r: any) => r.reply_id)
      .map((r: any) => `• @${r.commenter}: "${(r.comment_text ?? "").slice(0, 60)}…"`)
      .slice(0, 5);
    const msg = [
      `📸 *Instagram Comment Monitor*`,
      `${result.media_checked} post${result.media_checked !== 1 ? "s" : ""} checked · ${result.new_comments} new comment${result.new_comments !== 1 ? "s" : ""} · ${result.replied} repl${result.replied !== 1 ? "ies" : "y"} posted`,
      ``,
      lines.join("\n"),
    ].filter(Boolean).join("\n");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return { success: true, output: { media_checked: result.media_checked, new_comments: result.new_comments, replied: result.replied } };
};

// email_smart_triage — classify emails via AI → lookup category-specific prompt from Sheets → generate HTML reply draft
const handleEmailSmartTriage: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);
  const res = await callFunction("mavis-google-agent", {
    userId:         task.user_id,
    action:         "smart_triage",
    limit:          p.limit ?? 10,
    spreadsheet_id: p.spreadsheet_id ?? "",
    sheet_name:     p.sheet_name ?? "Prompts",
    categories:     p.categories ?? ["Inquiry/Requests", "Complaints/Issues", "Job Applications/Resumes"],
    signature:      p.signature ?? "",
    mark_read:      p.mark_read ?? false,
    state_key:      p.state_key ?? "smart_triage_state",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: (data as any).error ?? `google-agent returned ${res.status}` };

  const result = data as any;
  if (result.drafts_created > 0 && BOT_TOKEN && OPERATOR_CHAT_ID) {
    const catList = (result.categories_seen ?? []).join(", ") || "various";
    const lines = (result.results ?? [])
      .filter((r: any) => r.draft_id)
      .map((r: any) => `• [${r.category}] ${r.from?.split("<")[0].trim() || r.from} — ${r.subject}`)
      .slice(0, 5);
    const msg = [
      `📧 *Smart Email Triage*`,
      `${result.processed} email${result.processed !== 1 ? "s" : ""} · ${result.drafts_created} HTML draft${result.drafts_created !== 1 ? "s" : ""} created`,
      `Categories: ${catList}`,
      ``,
      lines.join("\n"),
    ].join("\n");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return { success: true, output: { processed: result.processed, drafts_created: result.drafts_created, categories_seen: result.categories_seen } };
};

// influencer_tweet — persona-driven viral tweet generator; self-re-queues after each run for continuous cadence
const handleInfluencerTweet: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);

  // 1. Generate tweet in persona/influencer mode with retry loop
  const genRes = await callFunction("mavis-twitter-agent", {
    action:      "generate_tweet",
    niche:       p.niche       ?? "personal development and modern philosophy",
    style:       p.style       ?? "All of your tweets are very personal and relatable",
    inspiration: p.inspiration ?? "",
    max_chars:   p.max_chars   ?? 280,
    max_retries: p.max_retries ?? 3,
  });
  const genData = await genRes.json().catch(() => ({})) as any;
  if (!genRes.ok) return { success: false, error: genData.error ?? `twitter-agent returned ${genRes.status}` };

  const { tweet } = genData;

  // 2. Log to Airtable if configured
  let airtableRecordId: string | null = null;
  if (p.airtable_base_id) {
    const atRes = await callFunction("mavis-airtable-agent", {
      userId:  task.user_id,
      action:  "create_record",
      base_id: p.airtable_base_id,
      table:   p.airtable_table ?? "Influencer Tweets",
      fields: {
        Niche:     p.niche ?? "personal development",
        Content:   tweet,
        Generated: new Date().toISOString().split("T")[0],
        Status:    p.auto_post ? "Posted" : "Draft",
        Attempts:  genData.attempts ?? 1,
      },
    });
    const atData = await atRes.json().catch(() => ({})) as any;
    airtableRecordId = atData.id ?? atData.record?.id ?? null;
  }

  // 3. Optionally post to Twitter
  let tweetId: string | null = null;
  if (p.auto_post) {
    const postRes = await callFunction("mavis-twitter-agent", { action: "post_tweet", text: tweet });
    const postData = await postRes.json().catch(() => ({})) as any;
    tweetId = postData.tweet_id ?? null;
  }

  // 4. Telegram notification
  if (BOT_TOKEN && OPERATOR_CHAT_ID) {
    const status = tweetId ? "✅ Posted" : "📝 Draft";
    const msg = [
      `🐦 *Influencer Tweet*`,
      `${status} · ${(p.niche as string ?? "").slice(0, 40)}`,
      ``,
      `"${tweet}"`,
      airtableRecordId ? `📊 Logged to Airtable (${airtableRecordId})` : "",
    ].filter(Boolean).join("\n");
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  // 5. Self-re-queue: schedule next run at intervalHours + random(0–55) minutes from now
  const intervalHours  = Math.max(1, Number(p.interval_hours ?? 6));
  const randomMinutes  = Math.floor(Math.random() * 56); // 0–55 min, mirrors n8n random minute
  const nextRunAt      = new Date(Date.now() + intervalHours * 3_600_000 + randomMinutes * 60_000);
  await supabase.from("mavis_tasks").insert({
    user_id:      task.user_id,
    type:         "influencer_tweet",
    description:  `Auto influencer tweet — ${p.niche ?? "personal development"}`,
    payload:      task.payload,
    status:       "pending",
    scheduled_at: nextRunAt.toISOString(),
  });

  return {
    success:    true,
    continuing: true,
    output:     { tweet, tweet_id: tweetId, airtable_record_id: airtableRecordId, next_run: nextRunAt.toISOString() },
  };
};

// reddit_opportunities — scan a subreddit for business opportunities, output to Sheets + Gmail drafts, deliver Telegram summary
const handleRedditOpportunities: TaskHandler = async (task) => {
  const p = extractPayload(task.payload as Record<string, unknown>);

  const res = await callFunction("mavis-reddit-agent", {
    userId: task.user_id,
    action: "analyze_opportunities",
    ...p,
  });
  const result = await res.json().catch(() => ({})) as any;

  if (BOT_TOKEN && OPERATOR_CHAT_ID) {
    const topItems: string = (result.results ?? []).slice(0, 3).map((r: any, i: number) =>
      `*${i + 1}.* ${r.summary}\n💡 ${String(r.solution ?? "").slice(0, 180)}${r.solution?.length > 180 ? "…" : ""}`
    ).join("\n\n");

    const msg = [
      `📊 *Reddit Opportunity Scan*`,
      `r/${result.subreddit} · keyword: \`${result.keyword}\``,
      ``,
      `📥 Fetched: ${result.fetched} → ✅ Qualified: ${result.qualified} → 📝 Analyzed: ${result.analyzed}`,
      result.sheets_appended ? `📊 Sheets: ${result.sheets_appended} rows added` : "",
      result.drafts_created ? `✉️ Gmail: ${result.drafts_created} drafts created` : "",
      topItems ? `\n${topItems}` : "",
    ].filter(Boolean).join("\n");

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: OPERATOR_CHAT_ID, text: msg, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  return { success: true, output: { analyzed: result.analyzed, qualified: result.qualified, results: result.results } };
};

const HANDLERS: Record<string, TaskHandler> = {
  daily_brief: handleDailyBrief,
  check_idle_quests: handleCheckIdleQuests,
  memory_consolidation: handleMemoryConsolidation,
  revenue_snapshot: handleRevenueSnapshot,
  idle_quest_alert: handleIdleQuestAlert,
  create_product: handleCreateProduct,
  send_announcement: handleSendAnnouncement,
  nora_tweet: handleNoraTweet,
  demand_scan: handleDemandScan,
  goal: handleGoal,
  execute_action: handleExecuteAction,
  system_change: handleSystemChange,
  session_update: handleSessionUpdate,
  send_outreach: handleSendOutreach,
  email_reply: handleEmailReply,
  standing_order: handleStandingOrder,
  nora_content_machine: handleNoraContentMachine,
  client_welcome_sequence: handleClientWelcomeSequence,
  google_agent:        handleGoogleAgent,
  slack_agent:         makeAgentHandler("mavis-slack-agent"),
  notion_agent:        makeAgentHandler("mavis-notion-agent"),
  airtable_agent:      makeAgentHandler("mavis-airtable-agent"),
  twilio_agent:        makeAgentHandler("mavis-twilio-agent"),
  calendly_agent:      makeAgentHandler("mavis-calendly-agent"),
  weekly_reflection:   handleWeeklyReflection,
  critic_agent:        makeAgentHandler("mavis-critic-agent"),
  orchestrator:        makeAgentHandler("mavis-orchestrator"),
  exa_agent:           makeAgentHandler("mavis-exa-agent"),
  firecrawl_agent:     makeAgentHandler("mavis-firecrawl-agent"),
  youtube_agent:       makeAgentHandler("mavis-youtube-agent"),
  spotify_agent:       makeAgentHandler("mavis-spotify-agent"),
  sec_agent:           makeAgentHandler("mavis-sec-agent"),
  crm_agent:           makeAgentHandler("mavis-crm-agent"),
  beehiiv_agent:       makeAgentHandler("mavis-beehiiv-agent"),
  shopify_agent:       makeAgentHandler("mavis-shopify-agent"),
  webhook_dispatch:    makeAgentHandler("mavis-webhook-dispatcher"),
  linear_agent:        makeAgentHandler("mavis-linear-agent"),
  vercel_agent:        makeAgentHandler("mavis-vercel-agent"),
  sentry_agent:        makeAgentHandler("mavis-sentry-agent"),
  sheets_agent:        makeAgentHandler("mavis-sheets-agent"),
  vision_agent:        makeAgentHandler("mavis-vision-agent"),
  video_narrator:      makeAgentHandler("mavis-video-narrator"),
  website_qa:          makeAgentHandler("mavis-website-qa"),
  instagram_trends:    makeAgentHandler("mavis-instagram-trends"),
  memory_agent:        makeAgentHandler("mavis-memory-agent"),
  heygen_agent:        makeAgentHandler("mavis-heygen-agent"),
  calendar_agent:      makeAgentHandler("mavis-calendar-agent"),
  security_scanner:    makeAgentHandler("mavis-security-scanner"),
  chain_builder:       makeAgentHandler("mavis-chain-builder"),
  social_content_pipeline: handleSocialContentPipeline,
  youtube_summary:     handleYoutubeSummary,
  content_digest:      handleContentDigest,
  email_triage:        handleEmailTriage,
  email_watch:         handleEmailWatch,
  email_smart_triage:  handleEmailSmartTriage,
  review_monitor:      handleReviewMonitor,
  instagram_monitor:   handleInstagramMonitor,
  hashtag_tweet:       handleHashtagTweet,
  influencer_tweet:    handleInfluencerTweet,
  daily_comic:         handleDailyComic,
  daily_story:         handleDailyStory,
  discord_agent:       makeAgentHandler("mavis-discord-agent"),
  flashcard_agent:     makeAgentHandler("mavis-flashcard-agent"),
  reddit_agent:        makeAgentHandler("mavis-reddit-agent"),
  reddit_opportunities: handleRedditOpportunities,
};

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const now = new Date().toISOString();
  const executed: unknown[] = [];
  const errors: unknown[] = [];

  try {
    // Load auto-execute type lists from mavis_tacit (key="auto_execute_types", value=JSON array).
    // Any requires_confirmation task whose type is in the user's auto_execute_types list
    // gets promoted to "approved" so it runs without Telegram approval.
    // Default: daily_brief, memory_consolidation, revenue_snapshot always auto-execute.
    const DEFAULT_AUTO_EXECUTE: string[] = ["daily_brief", "memory_consolidation", "revenue_snapshot"];
    try {
      const { data: tacitRows } = await supabase
        .from("mavis_tacit")
        .select("user_id, value")
        .eq("key", "auto_execute_types");

      if (tacitRows && tacitRows.length > 0) {
        for (const row of tacitRows as any[]) {
          let types: string[] = DEFAULT_AUTO_EXECUTE;
          try { types = JSON.parse(row.value); } catch { /* use default */ }
          if (!Array.isArray(types) || types.length === 0) continue;
          await supabase
            .from("mavis_tasks")
            .update({ status: "approved" })
            .eq("user_id", row.user_id)
            .eq("status", "requires_confirmation")
            .in("type", types);
        }
      } else {
        // No custom config — apply defaults to all users with pending confirmation tasks
        const { data: pendingConfirm } = await supabase
          .from("mavis_tasks")
          .select("id, user_id")
          .eq("status", "requires_confirmation")
          .in("type", DEFAULT_AUTO_EXECUTE);
        if (pendingConfirm && pendingConfirm.length > 0) {
          await supabase
            .from("mavis_tasks")
            .update({ status: "approved" })
            .in("id", (pendingConfirm as any[]).map((r: any) => r.id));
        }
      }
    } catch {
      // non-fatal — mavis_tacit table may not exist yet
    }

    // Fetch pending AND approved tasks (approved = operator confirmed a requires_confirmation item)
    const { data: pendingTasks, error: fetchErr } = await supabase
      .from("mavis_tasks")
      .select("*")
      .in("status", ["pending", "approved"])
      .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchErr) throw fetchErr;
    if (!pendingTasks || pendingTasks.length === 0) {
      return new Response(JSON.stringify({ status: "idle", message: "No pending tasks" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          if (result.continuing) {
            // Goal task re-queued itself for the next cron tick — don't mark complete
            executed.push({ taskId: task.id, type: task.type, status: "continuing", output: result.output });
          } else {
            await markComplete(task.id, result.output ?? {});
            executed.push({ taskId: task.id, type: task.type, status: "completed", output: result.output });
          }
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
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
