// MAVIS Task Executor — the autonomous worker.
// Polls mavis_tasks for pending work and executes each by type.
// Scheduled via cron-job.org every 15 minutes. Can also be triggered manually.
//
// Goal tasks implement a true agentic loop:
//   plan → act → observe → re-plan → repeat until objective achieved
//
// Each cron run advances one step. Claude observes results and replans if needed.

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

// continuing=true means the handler re-queued itself — do NOT call markComplete
type TaskResult = { success: boolean; continuing?: boolean; output?: unknown; error?: string };
type TaskHandler = (task: Task) => Promise<TaskResult>;

// ─────────────────────────────────────────────────────────────
// GOAL STEP TYPES
// A goal plan is an ordered array of GoalStep objects.
// Each step runs in one cron tick. Results feed Claude's next decision.
// ─────────────────────────────────────────────────────────────

interface GoalStep {
  type: string;           // demand_scan | revenue_snapshot | nora_tweet | direct_action | create_product | web_search | daily_brief
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

  // Flatten payload — accept both { title, ... } and { type, params: { title, ... } }
  const raw = task.payload as Record<string, unknown>;
  const flat = (raw.params && typeof raw.params === "object")
    ? raw.params as Record<string, unknown>
    : raw;

  const res = await fetch(`${supabaseUrl}/functions/v1/mavis-product-creator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ ...flat, userId: task.user_id }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    return { success: false, error: data.error ?? `product-creator returned ${res.status}` };
  }

  // Auto-queue an announcement for any successfully created product
  if ((data.gumroadProductId || data.stripeProductId) && data.paymentLink && flat.title) {
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

  return { success: true, output: data };
};

// send_announcement — email via Resend + Nora tweet via mavis-nora-post
const handleSendAnnouncement: TaskHandler = async (task) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const results: unknown[] = [];

  // Email announcement
  const emailRes = await fetch(`${supabaseUrl}/functions/v1/mavis-announce`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({ userId: task.user_id, ...task.payload }),
  });
  results.push({ channel: "email", ...(await emailRes.json()) });

  // Nora Vale tweet
  const p = task.payload as { title?: string; paymentLink?: string; priceCents?: number };
  if (p.title && p.paymentLink) {
    const price = `$${((p.priceCents ?? 2900) / 100).toFixed(0)}`;
    const tweetContent = `Just dropped: "${p.title}" — ${price}\n\nBuilt this for anyone who's been asking about this. Grab it here: ${p.paymentLink}`;
    const tweetRes = await fetch(`${supabaseUrl}/functions/v1/mavis-nora-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({ userId: task.user_id, content: tweetContent }),
    });
    results.push({ channel: "twitter_nora", ...(await tweetRes.json()) });
  }

  return { success: true, output: results };
};

// nora_tweet — Nora posts arbitrary content on Twitter/X
const handleNoraTweet: TaskHandler = async (task) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${supabaseUrl}/functions/v1/mavis-nora-post`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({ userId: task.user_id, ...task.payload }),
  });
  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error ?? `nora-post returned ${res.status}` };
  return { success: true, output: data };
};

// demand_scan — fires the demand detection scan
const handleDemandScan: TaskHandler = async (task) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${supabaseUrl}/functions/v1/mavis-demand-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({ userId: task.user_id }),
  });
  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error ?? `demand-scan returned ${res.status}` };
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
  nora_tweet: handleNoraTweet,
  demand_scan: handleDemandScan,
  goal: handleGoal,
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
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
