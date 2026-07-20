// mavis-autonomous-runner
// Long-horizon autonomous task executor — runs every 2 minutes via pg_cron.
// No user JWT required; uses service role. Advances each active task by exactly
// ONE step per invocation to avoid edge-function timeouts.
//
// Step types: research | reason | store | notify | execute | complete
//   "execute" calls arbitrary MAVIS edge functions by name, enabling the runner
//   to use the full 140+ capability surface during autonomous execution.
//
// Error recovery: each step is retried up to 3 times with exponential backoff.
//   On total failure the task is paused and a human-review entry is created in
//   mavis_action_queue (autonomy_tier = "approve") rather than hard-failing.
//
// config.toml entry required (do NOT edit that file — note only):
//   [functions.mavis-autonomous-runner]
//   verify_jwt = false

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// ── Env ───────────────────────────────────────────────────────────────────────
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const TAVILY_KEY = Deno.env.get("Tavily_API") ?? "";

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_TASKS_PER_RUN = 3;
const MAX_PLAN_STEPS = 20;
const STEP_MAX_ATTEMPTS = 3;
const TASK_TIME_BUDGET_MS = 45000; // 45s per task before yielding to next cron cycle
const PLANNER_MODEL = "claude-haiku-4-5-20251001";
const REASONER_MODEL = "claude-haiku-4-5-20251001";
const SYNTHESIZER_MODEL = "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type StepType = "research" | "reason" | "store" | "notify" | "execute" | "complete";
type TaskStatus = "pending" | "running" | "paused" | "completed" | "failed";

interface PlanStep {
  type: StepType;
  description: string;
  input?: Record<string, unknown>;
  output?: string;
  completed?: boolean;
  error?: string;
}

interface TaskContext {
  goal: string;
  steps_completed: Array<{ step: number; type: StepType; description: string; output: string }>;
  reasoning: string[];
  search_results: string[];
  [key: string]: unknown;
}

interface AutonomousTask {
  id: string;
  user_id: string;
  goal: string;
  plan: PlanStep[];
  current_step: number;
  context: TaskContext;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** Exponential backoff retry — throws the last error if all attempts fail. */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = STEP_MAX_ATTEMPTS,
  baseDelayMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(
          `[autonomous-runner] Attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms:`,
          err instanceof Error ? err.message : String(err),
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/** Raw Claude API call — reuses the pattern from mavis-crew-orchestrator. */
async function claudeCall(
  system: string,
  userMessage: string,
  model: string,
  maxTokens: number,
): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  if (!text) throw new Error("Claude returned an empty response");
  return text;
}

/** Tavily web search — falls back to Claude knowledge if key is absent. */
async function webSearch(query: string): Promise<string> {
  if (TAVILY_KEY) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query,
          search_depth: "basic",
          max_results: 5,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        const results: Array<{ title: string; content: string; url: string }> =
          data.results ?? [];
        return results
          .slice(0, 5)
          .map((r) => `[${r.title}] ${r.content} (${r.url})`)
          .join("\n\n");
      }
    } catch (err) {
      console.warn("[autonomous-runner] Tavily failed, falling back to Claude:", err);
    }
  }

  return claudeCall(
    "You are a knowledgeable research assistant. Answer the query with facts from your training data. Be specific and concise.",
    `Research query: ${query}`,
    REASONER_MODEL,
    1024,
  );
}

/** Call any MAVIS edge function by name with the given params. */
async function callEdgeFunction(
  fnName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${SB_URL}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(40000),
  });

  const data = res.ok ? await res.json() : null;
  if (!res.ok) {
    const errText = data ? JSON.stringify(data) : `HTTP ${res.status}`;
    throw new Error(`Function ${fnName} returned error: ${errText.slice(0, 300)}`);
  }
  return data;
}

// ── Dynamic replanning ────────────────────────────────────────────────────────

/**
 * After a research or reason step, ask Claude if the remaining plan is still
 * valid given the new output. If not, generate new remaining steps.
 * Returns a replacement tail-plan, or null if no replan is needed.
 */
async function replanRemainingSteps(
  task: AutonomousTask,
  completedStepIndex: number,
  stepOutput: string,
): Promise<PlanStep[] | null> {
  const remainingCount = task.plan.length - completedStepIndex - 1;
  if (remainingCount <= 1) return null; // Nothing meaningful to replan

  const completedSummary = task.context.steps_completed
    .slice(-3)
    .map((s) => `[${s.type}] ${s.description}: ${s.output.slice(0, 150)}`)
    .join("\n") || "(none yet)";

  const remainingPlan = task.plan
    .slice(completedStepIndex + 1)
    .map((s, i) => `${i + 1}. [${s.type}] ${s.description}`)
    .join("\n");

  // Quick yes/no check — use haiku to keep latency low
  const checkRaw = await claudeCall(
    "You evaluate whether an autonomous task plan needs updating based on new findings. Be conservative — only flag genuine invalidation, not minor deviations.",
    `Goal: ${task.goal.slice(0, 200)}\n\nNew finding from step ${completedStepIndex}: ${stepOutput.slice(0, 400)}\n\nRemaining planned steps:\n${remainingPlan}\n\nDoes this finding make the remaining plan invalid or significantly suboptimal?\nRespond ONLY as JSON: {"needs_replan": true/false, "reason": "brief reason"}`,
    PLANNER_MODEL,
    128,
  ).catch(() => '{"needs_replan": false}');

  let needsReplan = false;
  let reason = "";
  try {
    const parsed = JSON.parse((checkRaw.match(/\{[\s\S]*?\}/) ?? ["{}"])[0]);
    needsReplan = parsed.needs_replan === true;
    reason = String(parsed.reason ?? "");
  } catch {
    return null;
  }

  if (!needsReplan) return null;

  console.log(
    `[autonomous-runner] Replanning task ${task.id} after step ${completedStepIndex}: ${reason}`,
  );

  const replanRaw = await claudeCall(
    "You are MAVIS task replanner. Generate new remaining steps for a task given what was just learned.",
    `Goal: ${task.goal.slice(0, 200)}\n\nCompleted steps:\n${completedSummary}\n\nLatest finding: ${stepOutput.slice(0, 400)}\n\nReason to replan: ${reason}\n\nGenerate 2-6 new remaining steps as a JSON array. Each step: {type, description, input}. Valid types: research, reason, store, notify, execute, complete. Always end with "complete". Return ONLY the JSON array.`,
    PLANNER_MODEL,
    512,
  ).catch(() => "");

  const arrMatch = replanRaw.match(/\[[\s\S]*\]/);
  if (!arrMatch) return null;

  try {
    const parsed = JSON.parse(arrMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const validTypes = new Set(["research", "reason", "store", "notify", "execute", "complete"]);
    const newSteps: PlanStep[] = parsed
      .filter(
        (s: unknown) =>
          s &&
          typeof s === "object" &&
          validTypes.has((s as Record<string, unknown>).type as string) &&
          typeof (s as Record<string, unknown>).description === "string",
      )
      .slice(0, 8)
      .map((s: Record<string, unknown>) => ({
        type: s.type as StepType,
        description: String(s.description).slice(0, 500),
        input: (s.input as Record<string, unknown>) ?? {},
      }));
    return newSteps.length > 0 ? newSteps : null;
  } catch {
    return null;
  }
}

// ── Phase 1: PLAN ─────────────────────────────────────────────────────────────

async function planTask(
  sb: ReturnType<typeof createClient>,
  task: AutonomousTask,
): Promise<{ advanced: boolean }> {
  console.log(`[autonomous-runner] Planning task ${task.id}: ${task.goal.slice(0, 80)}`);

  const system =
    "You are MAVIS autonomous task planner. Given a goal, output a JSON array of 3-8 steps.\n" +
    "Each step must be one of:\n" +
    '  { "type": "research",  "description": string, "input": { "query": string } }\n' +
    '  { "type": "reason",   "description": string, "input": {} }\n' +
    '  { "type": "store",    "description": string, "input": { "content": string } }\n' +
    '  { "type": "notify",   "description": string, "input": { "message": string } }\n' +
    '  { "type": "execute",  "description": string, "input": { "function": "<edge-fn-name>", "params": {} } }\n' +
    '  { "type": "complete", "description": string, "input": {} }\n\n' +
    'The "execute" type calls a live MAVIS edge function. Common functions:\n' +
    '  mavis-director        — general AI query/action (params: message, user_id)\n' +
    '  mavis-screenpipe      — desktop context capture (params: action, user_id)\n' +
    '  mavis-webhook-dispatch — send outbound webhook (params: event_type, user_id, payload)\n' +
    "Always end with a step of type \"complete\". Return ONLY the JSON array, no prose.";

  const userMsg = `Goal: ${task.goal}\n\nGenerate a step plan as JSON array.`;

  let planRaw: string;
  try {
    planRaw = await withRetry(() => claudeCall(system, userMsg, PLANNER_MODEL, 1024));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[autonomous-runner] Plan generation failed for ${task.id}:`, msg);
    await sb
      .from("mavis_autonomous_tasks")
      .update({ status: "failed", error: `Plan generation failed: ${msg}`, updated_at: nowIso() })
      .eq("id", task.id);
    return { advanced: false };
  }

  const match = planRaw.match(/\[[\s\S]*\]/);
  if (!match) {
    const errMsg = "Planner did not return a valid JSON array";
    console.error(`[autonomous-runner] ${errMsg} for task ${task.id}`);
    await sb
      .from("mavis_autonomous_tasks")
      .update({ status: "failed", error: errMsg, updated_at: nowIso() })
      .eq("id", task.id);
    return { advanced: false };
  }

  let plan: PlanStep[];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("Parsed value is not a non-empty array");
    }
    const validTypes = new Set<StepType>(["research", "reason", "store", "notify", "execute", "complete"]);
    plan = parsed
      .filter(
        (s: unknown) =>
          s &&
          typeof s === "object" &&
          typeof (s as Record<string, unknown>).type === "string" &&
          validTypes.has((s as Record<string, unknown>).type as StepType) &&
          typeof (s as Record<string, unknown>).description === "string",
      )
      .slice(0, MAX_PLAN_STEPS)
      .map((s: Record<string, unknown>) => ({
        type: s.type as StepType,
        description: String(s.description).slice(0, 500),
        input: (s.input as Record<string, unknown>) ?? {},
      }));

    if (plan.length === 0) throw new Error("No valid steps after sanitisation");
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[autonomous-runner] Plan parse error for ${task.id}:`, msg);
    await sb
      .from("mavis_autonomous_tasks")
      .update({ status: "failed", error: `Plan parse error: ${msg}`, updated_at: nowIso() })
      .eq("id", task.id);
    return { advanced: false };
  }

  const context: TaskContext = {
    goal: task.goal,
    steps_completed: [],
    reasoning: [],
    search_results: [],
  };

  const { error: updateErr } = await sb
    .from("mavis_autonomous_tasks")
    .update({
      plan,
      status: "running",
      current_step: 0,
      context,
      updated_at: nowIso(),
    })
    .eq("id", task.id);

  if (updateErr) {
    console.error(`[autonomous-runner] Failed to save plan for ${task.id}:`, updateErr.message);
    return { advanced: false };
  }

  console.log(`[autonomous-runner] Task ${task.id} planned (${plan.length} steps), now running`);
  return { advanced: true };
}

// ── Phase 2: EXECUTE (one step) ───────────────────────────────────────────────

async function synthesiseFinal(task: AutonomousTask): Promise<string> {
  const contextSummary = [
    `Goal: ${task.context.goal}`,
    task.context.reasoning.length > 0
      ? `Reasoning:\n${task.context.reasoning.join("\n")}`
      : "",
    task.context.search_results.length > 0
      ? `Research:\n${task.context.search_results.join("\n")}`
      : "",
    task.context.steps_completed.length > 0
      ? `Steps completed:\n${task.context.steps_completed
          .map((s) => `[Step ${s.step + 1} – ${s.type}] ${s.description}: ${s.output}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return claudeCall(
    "You are MAVIS. Synthesize the outputs from an autonomous multi-step task into a clear, " +
      "comprehensive final result. Be direct and actionable.",
    `${contextSummary}\n\nProvide the final synthesized result for this task.`,
    SYNTHESIZER_MODEL,
    2048,
  );
}

/**
 * Execute the logic for a single step. Returns the step output string.
 * Throws on failure — caller handles retry and approval escalation.
 */
async function runStepLogic(
  step: PlanStep,
  stepIndex: number,
  task: AutonomousTask,
  updatedContext: TaskContext,
  sb: ReturnType<typeof createClient>,
): Promise<string> {
  const input = (step.input ?? {}) as Record<string, unknown>;

  switch (step.type) {
    // ── research ──────────────────────────────────────────────────────────────
    case "research": {
      const query = String(input.query ?? "") || step.description;
      const result = await webSearch(query);
      updatedContext.search_results.push(
        `[Step ${stepIndex}] ${step.description}: ${result.slice(0, 800)}`,
      );
      return result;
    }

    // ── reason ────────────────────────────────────────────────────────────────
    case "reason": {
      const contextForReason = [
        `Goal: ${task.context.goal}`,
        task.context.reasoning.length > 0
          ? `Prior reasoning:\n${task.context.reasoning.slice(-3).join("\n")}`
          : "",
        task.context.search_results.length > 0
          ? `Research findings:\n${task.context.search_results.slice(-3).join("\n")}`
          : "",
        `Current task: ${step.description}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await claudeCall(
        "You are MAVIS reasoning engine. Think step by step to address the task.",
        contextForReason,
        REASONER_MODEL,
        1024,
      );
      updatedContext.reasoning.push(
        `[Step ${stepIndex}] ${step.description}: ${result.slice(0, 600)}`,
      );
      return result;
    }

    // ── store ─────────────────────────────────────────────────────────────────
    case "store": {
      const content = String(input.content ?? "") || step.description;
      // mavis_memory requires session_id, role, content, timestamp (all NOT NULL).
      const { error: insertErr } = await sb.from("mavis_memory").insert({
        user_id: task.user_id,
        session_id: `autonomous-${task.id}`,
        role: "assistant",
        content: content.slice(0, 4000),
        timestamp: Date.now(),
      });
      if (insertErr) throw new Error(`Memory insert failed: ${insertErr.message}`);
      return "stored";
    }

    // ── notify ────────────────────────────────────────────────────────────────
    case "notify": {
      const message = String(input.message ?? "") || step.description;
      // mavis_insights columns are title, content, category, severity, source.
      const { error: insightErr } = await sb.from("mavis_insights").insert({
        user_id: task.user_id,
        title: step.description.slice(0, 120),
        content: message.slice(0, 2000),
        category: "autonomous",
        severity: "info",
        source: "autonomous-runner",
      });
      if (insightErr) throw new Error(`Insight insert failed: ${insightErr.message}`);
      return "notified";
    }

    // ── execute — calls a live MAVIS edge function ─────────────────────────
    case "execute": {
      const fnName = String(input.function ?? "").trim();
      if (!fnName) throw new Error('execute step missing required "function" field');

      const fnParams = ((input.params as Record<string, unknown>) ?? {});
      // Always inject user_id so called functions know who they're acting for
      if (!fnParams.user_id) fnParams.user_id = task.user_id;

      console.log(
        `[autonomous-runner] Task ${task.id} step ${stepIndex}: calling ${fnName} with`,
        JSON.stringify(fnParams).slice(0, 200),
      );

      const fnResult = await callEdgeFunction(fnName, fnParams);
      return JSON.stringify(fnResult).slice(0, 800);
    }

    // ── complete ──────────────────────────────────────────────────────────────
    case "complete": {
      return await synthesiseFinal(task);
    }

    default: {
      return `Unknown step type: ${(step as PlanStep).type}`;
    }
  }
}

/** Execute exactly one step of a running task (with retry + approval escalation). */
async function executeStep(
  sb: ReturnType<typeof createClient>,
  task: AutonomousTask,
): Promise<{ advanced: boolean }> {
  const stepIndex = task.current_step;
  const step = task.plan[stepIndex];

  if (!step) {
    // Plan exhausted without a "complete" step — auto-synthesise
    console.log(`[autonomous-runner] Task ${task.id} plan exhausted at step ${stepIndex} — auto-completing`);
    let synthesis: string;
    try {
      synthesis = await withRetry(() => synthesiseFinal(task));
    } catch {
      synthesis = `Task completed after ${stepIndex} steps. Context: ${JSON.stringify(task.context.steps_completed)}`;
    }
    await sb
      .from("mavis_autonomous_tasks")
      .update({
        status: "completed",
        result: synthesis,
        completed_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", task.id);
    return { advanced: true };
  }

  console.log(
    `[autonomous-runner] Task ${task.id} step ${stepIndex}/${task.plan.length - 1} (${step.type}): ${step.description.slice(0, 80)}`,
  );

  const updatedContext: TaskContext = {
    ...task.context,
    steps_completed: [...task.context.steps_completed],
    reasoning: [...task.context.reasoning],
    search_results: [...task.context.search_results],
  };

  // ── Run step with retry ───────────────────────────────────────────────────
  let stepOutput = "";
  let lastError: string | undefined;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= STEP_MAX_ATTEMPTS; attempt++) {
    attemptsUsed = attempt;
    try {
      stepOutput = await runStepLogic(step, stepIndex, task, updatedContext, sb);
      lastError = undefined;
      break;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[autonomous-runner] Step ${stepIndex} attempt ${attempt}/${STEP_MAX_ATTEMPTS} failed for task ${task.id}:`,
        lastError,
      );
      if (attempt < STEP_MAX_ATTEMPTS) {
        const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s → 2s
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  // ── All retries exhausted → escalate to human approval ───────────────────
  if (lastError !== undefined) {
    console.error(
      `[autonomous-runner] Step ${stepIndex} (${step.type}) exhausted all retries for task ${task.id}. Escalating.`,
    );

    const approvalDescription =
      `Autonomous task "${task.goal.slice(0, 100)}" stalled at step ${stepIndex} ` +
      `(${step.type}: "${step.description.slice(0, 80)}") after ${attemptsUsed} attempts.\n\n` +
      `Error: ${lastError}\n\n` +
      `Progress so far:\n${task.context.steps_completed
        .slice(-5)
        .map((s) => `  [${s.step + 1}] ${s.type}: ${s.output.slice(0, 120)}`)
        .join("\n") || "  (no steps completed yet)"}`;

    // Create approval queue entry — user can review and retry or cancel
    // mavis_action_queue columns: action_type, action_payload, autonomy_tier,
    // status, summary, source_system, source_context (no title/description/payload).
    await Promise.resolve(sb
      .from("mavis_action_queue")
      .insert({
        user_id: task.user_id,
        action_type: "task_step_failure",
        summary: `Task stalled: ${step.description.slice(0, 60)}`,
        source_system: "autonomous-runner",
        source_context: approvalDescription.slice(0, 2000),
        status: "pending",
        autonomy_tier: "approve",
        action_payload: {
          task_id: task.id,
          step_index: stepIndex,
          step_type: step.type,
          step_description: step.description,
          error: lastError,
          attempts: attemptsUsed,
        },
      }))
      .catch((e) => console.error("[autonomous-runner] Failed to create approval entry:", e));

    // Pause (not fail) the task — it can be resumed after human review
    await sb
      .from("mavis_autonomous_tasks")
      .update({
        status: "paused",
        error: `Step ${stepIndex} (${step.type}) failed after ${attemptsUsed} attempts — awaiting review`,
        updated_at: nowIso(),
      })
      .eq("id", task.id);

    return { advanced: false };
  }

  // ── Step succeeded — record and advance ───────────────────────────────────

  // "complete" step already calls synthesiseFinal; persist it as completed
  if (step.type === "complete") {
    updatedContext.steps_completed.push({
      step: stepIndex,
      type: step.type,
      description: step.description,
      output: stepOutput.slice(0, 300),
    });

    await sb
      .from("mavis_autonomous_tasks")
      .update({
        plan: task.plan.map((s, i) =>
          i === stepIndex ? { ...s, output: stepOutput, completed: true } : s,
        ),
        context: updatedContext,
        status: "completed",
        result: stepOutput,
        completed_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", task.id);

    console.log(`[autonomous-runner] Task ${task.id} completed`);
    return { advanced: true };
  }

  const nextStep = stepIndex + 1;
  updatedContext.steps_completed.push({
    step: stepIndex,
    type: step.type,
    description: step.description,
    output: stepOutput.slice(0, 300),
  });

  let updatedPlan = task.plan.map((s, i) =>
    i === stepIndex ? { ...s, output: stepOutput, completed: true } : s,
  );

  // Dynamic replanning: after research/reason steps, check if remaining plan is still valid
  if ((step.type === "research" || step.type === "reason") && nextStep < task.plan.length - 1) {
    const newTail = await replanRemainingSteps(task, stepIndex, stepOutput).catch(() => null);
    if (newTail && newTail.length > 0) {
      updatedPlan = [
        ...updatedPlan.slice(0, nextStep), // completed steps (including current)
        ...newTail,                         // new remaining steps
      ];
      console.log(
        `[autonomous-runner] Task ${task.id} replanned with ${newTail.length} new steps from step ${nextStep}`,
      );
    }
  }

  const isLastStep = nextStep >= updatedPlan.length;

  if (isLastStep) {
    let finalResult = stepOutput;
    try {
      finalResult = await withRetry(() =>
        synthesiseFinal({ ...task, context: updatedContext, plan: updatedPlan }),
      );
    } catch {
      // keep last step output
    }

    await sb
      .from("mavis_autonomous_tasks")
      .update({
        plan: updatedPlan,
        context: updatedContext,
        current_step: nextStep,
        status: "completed",
        result: finalResult,
        completed_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", task.id);

    console.log(`[autonomous-runner] Task ${task.id} completed after step ${stepIndex}`);
  } else {
    const { error: updateErr } = await sb
      .from("mavis_autonomous_tasks")
      .update({
        plan: updatedPlan,
        context: updatedContext,
        current_step: nextStep,
        updated_at: nowIso(),
      })
      .eq("id", task.id);

    if (updateErr) {
      console.error(
        `[autonomous-runner] Failed to advance step for task ${task.id}:`,
        updateErr.message,
      );
      return { advanced: false };
    }

    console.log(
      `[autonomous-runner] Task ${task.id} advanced to step ${nextStep}/${task.plan.length - 1}`,
    );
  }

  return { advanced: true };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    // ── Promote due standing orders into autonomous tasks ─────────────────────
    try {
      const now = new Date().toISOString();
      const { data: dueOrders } = await sb
        .from("standing_order_templates")
        .select("*")
        .eq("status", "active")
        .not("next_run_at", "is", null)
        .lte("next_run_at", now);

      for (const order of (dueOrders ?? []) as any[]) {
        await sb.from("mavis_autonomous_tasks").insert({
          user_id: order.user_id,
          goal: `[Standing Order: ${order.name}]\n${order.instructions}`,
          status: "pending",
          plan: [],
          current_step: 0,
          context: {
            goal: order.instructions,
            steps_completed: [],
            reasoning: [],
            search_results: [],
            source: "standing_order",
            template_id: order.id,
            template_slug: order.slug,
          },
        });

        await sb.from("mavis_so_executions").insert({
          template_id: order.id,
          template_slug: order.slug,
          status: "running",
          triggered_by: "cron",
          started_at: now,
          turns_used: 0,
        });

        const cron = (order.cron_expression ?? "") as string;
        let intervalMs = 24 * 60 * 60 * 1000;
        if (/^\*\/\d+\s+\*/.test(cron)) {
          const mins = parseInt(cron.match(/^\*\/(\d+)/)?.[1] ?? "1440", 10);
          intervalMs = mins * 60 * 1000;
        } else if (/^0\s+\*\s+/.test(cron)) {
          intervalMs = 60 * 60 * 1000;
        } else if (/^0\s+\d+\s+\*\s+\*\s+\d/.test(cron)) {
          intervalMs = 7 * 24 * 60 * 60 * 1000;
        }

        await sb.from("standing_order_templates").update({
          usage_count: (order.usage_count ?? 0) + 1,
          last_used_at: now,
          next_run_at: new Date(Date.now() + intervalMs).toISOString(),
        }).eq("id", order.id);
      }
    } catch (soErr) {
      console.error("[autonomous-runner] Standing orders check failed:", soErr);
    }

    // ── Execute pending A2A tasks ─────────────────────────────────────────────
    try {
      const { data: a2aTasks } = await sb
        .from("mavis_a2a_tasks")
        .select("id, user_id, skill_id, input, calling_agent_url")
        .eq("status", "pending")
        .limit(5);

      for (const task of (a2aTasks ?? []) as any[]) {
        await sb
          .from("mavis_a2a_tasks")
          .update({ status: "running", updated_at: nowIso() })
          .eq("id", task.id);

        try {
          const input = task.input ?? {};
          const inputMessage: string =
            (typeof input === "string" ? input : null) ??
            input.message ?? input.text ?? input.query ?? input.content ??
            JSON.stringify(input).slice(0, 500);

          const SKILL_INTENT: Record<string, string> = {
            knowledge_query: "query",
            quest_manage: "action",
            journal_entry: "action",
            code_review: "query",
            image_gen: "action",
          };

          const directorRes = await fetch(`${SB_URL}/functions/v1/mavis-director`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SB_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: inputMessage,
              user_id: task.user_id,
              source: "a2a",
              intent_hint: SKILL_INTENT[task.skill_id] ?? undefined,
            }),
            signal: AbortSignal.timeout(50000),
          });

          const directorData = directorRes.ok ? await directorRes.json() : null;
          const reply: string = directorData?.reply ?? `Director error: HTTP ${directorRes.status}`;

          await sb.from("mavis_a2a_tasks").update({
            status: "completed",
            result: { reply, intent: directorData?.intent },
            updated_at: nowIso(),
          }).eq("id", task.id);
        } catch (taskErr: any) {
          console.error("[autonomous-runner] A2A task execution failed:", taskErr?.message);
          await sb.from("mavis_a2a_tasks").update({
            status: "failed",
            error: taskErr?.message ?? "Unknown error",
            updated_at: nowIso(),
          }).eq("id", task.id);
        }
      }
    } catch (a2aErr) {
      console.error("[autonomous-runner] A2A task check failed:", a2aErr);
    }

    // ── Fetch pending/running tasks ───────────────────────────────────────────
    const { data: taskRows, error: fetchErr } = await sb
      .from("mavis_autonomous_tasks")
      .select("*")
      .in("status", ["pending", "running"])
      .order("updated_at", { ascending: true })
      .limit(MAX_TASKS_PER_RUN);

    if (fetchErr) {
      console.error("[autonomous-runner] Failed to fetch tasks:", fetchErr.message);
      return json({ error: fetchErr.message }, 500);
    }

    const tasks = (taskRows ?? []) as AutonomousTask[];

    if (tasks.length === 0) {
      return json({ processed: 0, advanced: 0, message: "No active tasks" });
    }

    let processed = 0;
    let advanced = 0;
    let stepsTotal = 0;

    for (const initialTask of tasks) {
      const taskStart = Date.now();
      let currentTask = initialTask;
      let stepsThisTask = 0;

      try {
        // Time-budgeted multi-step loop: advance as many steps as time allows.
        // This means fast tasks (research → reason → complete) can finish in one
        // cron cycle instead of waiting 4-6 minutes across multiple invocations.
        while (Date.now() - taskStart < TASK_TIME_BUDGET_MS) {
          let result: { advanced: boolean };

          if (currentTask.status === "pending") {
            result = await planTask(sb, currentTask);
          } else if (currentTask.status === "running") {
            result = await executeStep(sb, currentTask);
          } else {
            break; // terminal state — completed/failed/paused
          }

          if (result.advanced) {
            advanced++;
            stepsThisTask++;
          }

          // Re-fetch to see current state after the step
          const { data: refreshed } = await sb
            .from("mavis_autonomous_tasks")
            .select("*")
            .eq("id", currentTask.id)
            .single();

          if (!refreshed || !["pending", "running"].includes(refreshed.status)) {
            break; // Task reached a terminal state
          }

          currentTask = refreshed as AutonomousTask;
        }

        processed++;
        stepsTotal += stepsThisTask;
        console.log(
          `[autonomous-runner] Task ${currentTask.id}: ${stepsThisTask} steps in ${Date.now() - taskStart}ms`,
        );
      } catch (taskErr: unknown) {
        const msg = taskErr instanceof Error ? taskErr.message : String(taskErr);
        console.error(`[autonomous-runner] Unhandled error for task ${currentTask.id}:`, msg);

        try {
          await sb
            .from("mavis_autonomous_tasks")
            .update({ status: "failed", error: `Runner error: ${msg}`, updated_at: nowIso() })
            .eq("id", currentTask.id);
        } catch {
          // ignore secondary failure
        }

        processed++;
      }
    }

    return json({ processed, advanced, steps_total: stepsTotal });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[autonomous-runner] Fatal error:", message);
    return json({ error: message }, 500);
  }
});
