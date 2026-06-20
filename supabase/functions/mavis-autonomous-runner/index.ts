// mavis-autonomous-runner
// Long-horizon autonomous task executor — runs every 2 minutes via pg_cron.
// No user JWT required; uses service role. Advances each active task by exactly
// ONE step per invocation to avoid edge-function timeouts.
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
const PLANNER_MODEL = "claude-haiku-4-5-20251001";
const REASONER_MODEL = "claude-haiku-4-5-20251001";
const SYNTHESIZER_MODEL = "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type StepType = "research" | "reason" | "store" | "notify" | "complete";
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

  // Fallback: Claude reasons from training data
  return claudeCall(
    "You are a knowledgeable research assistant. Answer the query with facts from your training data. Be specific and concise.",
    `Research query: ${query}`,
    REASONER_MODEL,
    1024,
  );
}

// ── Phase 1: PLAN ─────────────────────────────────────────────────────────────

/** Generate a step plan for a pending task. */
async function planTask(
  sb: ReturnType<typeof createClient>,
  task: AutonomousTask,
): Promise<{ advanced: boolean }> {
  console.log(`[autonomous-runner] Planning task ${task.id}: ${task.goal.slice(0, 80)}`);

  const system =
    "You are MAVIS autonomous task planner. Given a goal, output a JSON array of 3-8 steps. " +
    'Each step must be: { "type": "research"|"reason"|"store"|"notify"|"complete", ' +
    '"description": string, "input": any }. ' +
    'Always end with a step of type "complete". Return ONLY the JSON array, no prose.';

  const userMsg = `Goal: ${task.goal}\n\nGenerate a step plan as JSON array.`;

  let planRaw: string;
  try {
    planRaw = await claudeCall(system, userMsg, PLANNER_MODEL, 1024);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[autonomous-runner] Plan generation failed for ${task.id}:`, msg);
    await sb
      .from("mavis_autonomous_tasks")
      .update({ status: "failed", error: `Plan generation failed: ${msg}`, updated_at: nowIso() })
      .eq("id", task.id);
    return { advanced: false };
  }

  // Extract the JSON array from the response (robust against prose preamble)
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
    // Sanitise: enforce known types, cap at MAX_PLAN_STEPS
    const validTypes = new Set<StepType>(["research", "reason", "store", "notify", "complete"]);
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

  if (plan.length > MAX_PLAN_STEPS) {
    const errMsg = `Plan exceeds max steps (${plan.length} > ${MAX_PLAN_STEPS})`;
    await sb
      .from("mavis_autonomous_tasks")
      .update({ status: "failed", error: errMsg, updated_at: nowIso() })
      .eq("id", task.id);
    return { advanced: false };
  }

  // Initialise context
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

/** Synthesise all step outputs into a final result string. */
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

/** Execute exactly one step of a running task. */
async function executeStep(
  sb: ReturnType<typeof createClient>,
  task: AutonomousTask,
): Promise<{ advanced: boolean }> {
  const stepIndex = task.current_step;
  const step = task.plan[stepIndex];

  if (!step) {
    // plan exhausted without a 'complete' step — auto-synthesise
    console.log(`[autonomous-runner] Task ${task.id} plan exhausted at step ${stepIndex} — auto-completing`);
    let synthesis: string;
    try {
      synthesis = await synthesiseFinal(task);
    } catch (err: unknown) {
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

  // Mutable copies of context arrays
  const updatedContext: TaskContext = {
    ...task.context,
    steps_completed: [...task.context.steps_completed],
    reasoning: [...task.context.reasoning],
    search_results: [...task.context.search_results],
  };

  let stepOutput = "";
  let stepError: string | undefined;

  try {
    switch (step.type) {
      // ── research ──────────────────────────────────────────────────────────
      case "research": {
        const query =
          String((step.input as Record<string, unknown>)?.query ?? "") ||
          step.description;
        stepOutput = await webSearch(query);
        updatedContext.search_results.push(
          `[Step ${stepIndex}] ${step.description}: ${stepOutput.slice(0, 800)}`,
        );
        break;
      }

      // ── reason ────────────────────────────────────────────────────────────
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

        stepOutput = await claudeCall(
          "You are MAVIS reasoning engine. Think step by step to address the task.",
          contextForReason,
          REASONER_MODEL,
          1024,
        );
        updatedContext.reasoning.push(
          `[Step ${stepIndex}] ${step.description}: ${stepOutput.slice(0, 600)}`,
        );
        break;
      }

      // ── store ─────────────────────────────────────────────────────────────
      case "store": {
        const content =
          String((step.input as Record<string, unknown>)?.content ?? "") ||
          step.description;
        const { error: insertErr } = await sb.from("mavis_memory").insert({
          user_id: task.user_id,
          role: "assistant",
          content: content.slice(0, 4000),
        });
        if (insertErr) throw new Error(`Memory insert failed: ${insertErr.message}`);
        stepOutput = "stored";
        break;
      }

      // ── notify ────────────────────────────────────────────────────────────
      case "notify": {
        const message =
          String((step.input as Record<string, unknown>)?.message ?? "") ||
          step.description;
        const { error: insightErr } = await sb.from("mavis_insights").insert({
          user_id: task.user_id,
          category: "autonomous",
          insight: message.slice(0, 2000),
          importance_score: 6,
        });
        if (insightErr) throw new Error(`Insight insert failed: ${insightErr.message}`);
        stepOutput = "notified";
        break;
      }

      // ── complete ──────────────────────────────────────────────────────────
      case "complete": {
        stepOutput = await synthesiseFinal(task);
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

      default: {
        stepOutput = `Unknown step type: ${(step as PlanStep).type}`;
        break;
      }
    }
  } catch (err: unknown) {
    stepError = err instanceof Error ? err.message : String(err);
    console.error(
      `[autonomous-runner] Step ${stepIndex} (${step.type}) failed for task ${task.id}:`,
      stepError,
    );

    // Mark this task as failed — do not affect other tasks
    await sb
      .from("mavis_autonomous_tasks")
      .update({
        status: "failed",
        error: `Step ${stepIndex} (${step.type}) failed: ${stepError}`,
        updated_at: nowIso(),
      })
      .eq("id", task.id);
    return { advanced: false };
  }

  // Record step completion and advance pointer
  const nextStep = stepIndex + 1;
  updatedContext.steps_completed.push({
    step: stepIndex,
    type: step.type,
    description: step.description,
    output: stepOutput.slice(0, 300),
  });

  const updatedPlan = task.plan.map((s, i) =>
    i === stepIndex ? { ...s, output: stepOutput, completed: true } : s,
  );

  // Auto-complete if we've advanced past the last step
  const isLastStep = nextStep >= task.plan.length;

  if (isLastStep) {
    let finalResult = stepOutput;
    try {
      finalResult = await synthesiseFinal({
        ...task,
        context: updatedContext,
        plan: updatedPlan,
      });
    } catch {
      // keep last step output as result
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
    // Service-role client — no user JWT
    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

    // ── Promote due standing orders into autonomous tasks ─────────────────────
    // Checks standing_order_templates where next_run_at is due and status=active.
    // Creates one mavis_autonomous_tasks entry per order, logs to mavis_so_executions,
    // then advances next_run_at so it won't fire again until the next interval.
    try {
      const now = new Date().toISOString();
      const { data: dueOrders } = await sb
        .from("standing_order_templates")
        .select("*")
        .eq("status", "active")
        .not("next_run_at", "is", null)
        .lte("next_run_at", now);

      for (const order of (dueOrders ?? []) as any[]) {
        // Create an autonomous task from this standing order
        await sb.from("mavis_autonomous_tasks").insert({
          user_id:      order.user_id,
          goal:         `[Standing Order: ${order.name}]\n${order.instructions}`,
          status:       "pending",
          plan:         [],
          current_step: 0,
          context: {
            goal:             order.instructions,
            steps_completed:  [],
            reasoning:        [],
            search_results:   [],
            source:           "standing_order",
            template_id:      order.id,
            template_slug:    order.slug,
          },
        });

        // Log execution entry
        await sb.from("mavis_so_executions").insert({
          template_id:  order.id,
          template_slug: order.slug,
          status:       "running",
          triggered_by: "cron",
          started_at:   now,
          turns_used:   0,
        });

        // Advance next_run_at based on the cron expression (simple interval mapping)
        const cron = (order.cron_expression ?? "") as string;
        let intervalMs = 24 * 60 * 60 * 1000; // default: 1 day
        if (/^\*\/\d+\s+\*/.test(cron)) {
          const mins = parseInt(cron.match(/^\*\/(\d+)/)?.[1] ?? "1440", 10);
          intervalMs = mins * 60 * 1000;
        } else if (/^0\s+\*\s+/.test(cron)) {
          intervalMs = 60 * 60 * 1000; // hourly
        } else if (/^0\s+\d+\s+\*\s+\*\s+\d/.test(cron)) {
          intervalMs = 7 * 24 * 60 * 60 * 1000; // weekly
        }
        const nextRun = new Date(Date.now() + intervalMs).toISOString();

        await sb.from("standing_order_templates").update({
          usage_count:  (order.usage_count ?? 0) + 1,
          last_used_at: now,
          next_run_at:  nextRun,
        }).eq("id", order.id);
      }
    } catch (soErr) {
      console.error("[autonomous-runner] Standing orders check failed:", soErr);
      // Non-fatal — continue with regular task processing
    }

    // ── Execute pending A2A tasks (inbound from external agents) ─────────────
    // Picks up mavis_a2a_tasks where status='pending', routes each through the
    // Director, then writes the reply back as the completed result.
    try {
      const { data: a2aTasks } = await sb
        .from("mavis_a2a_tasks")
        .select("id, user_id, skill_id, input, calling_agent_url")
        .eq("status", "pending")
        .limit(5);

      for (const task of (a2aTasks ?? []) as any[]) {
        // Mark as running immediately to avoid double-processing
        await sb
          .from("mavis_a2a_tasks")
          .update({ status: "running", updated_at: nowIso() })
          .eq("id", task.id);

        try {
          // Extract the natural-language message from the task input (flexible schema)
          const input = task.input ?? {};
          const inputMessage: string =
            (typeof input === "string" ? input : null) ??
            input.message ?? input.text ?? input.query ?? input.content ??
            JSON.stringify(input).slice(0, 500);

          // Skill → intent hint mapping
          const SKILL_INTENT: Record<string, string> = {
            knowledge_query: "query",
            quest_manage:    "action",
            journal_entry:   "action",
            code_review:     "query",
            image_gen:       "action",
          };
          const intentHint = SKILL_INTENT[task.skill_id] ?? undefined;

          // Route through the Director
          const directorRes = await fetch(`${SB_URL}/functions/v1/mavis-director`, {
            method: "POST",
            headers: {
              Authorization:   `Bearer ${SB_KEY}`,
              "Content-Type":  "application/json",
            },
            body: JSON.stringify({
              message:      inputMessage,
              user_id:      task.user_id,
              source:       "a2a",
              intent_hint:  intentHint,
            }),
            signal: AbortSignal.timeout(50000),
          });

          const directorData = directorRes.ok ? await directorRes.json() : null;
          const reply: string = directorData?.reply ?? `Director error: HTTP ${directorRes.status}`;

          await sb.from("mavis_a2a_tasks").update({
            status:     "completed",
            result:     { reply, intent: directorData?.intent },
            updated_at: nowIso(),
          }).eq("id", task.id);

        } catch (taskErr: any) {
          console.error("[autonomous-runner] A2A task execution failed:", taskErr?.message);
          await sb.from("mavis_a2a_tasks").update({
            status:     "failed",
            error:      taskErr?.message ?? "Unknown error",
            updated_at: nowIso(),
          }).eq("id", task.id);
        }
      }
    } catch (a2aErr) {
      console.error("[autonomous-runner] A2A task check failed:", a2aErr);
      // Non-fatal
    }

    // ── Fetch up to MAX_TASKS_PER_RUN pending/running tasks (oldest first) ──
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

    for (const task of tasks) {
      try {
        let result: { advanced: boolean };

        if (task.status === "pending") {
          result = await planTask(sb, task);
        } else {
          // status === 'running'
          result = await executeStep(sb, task);
        }

        processed++;
        if (result.advanced) advanced++;
      } catch (taskErr: unknown) {
        // Catch-all: a catastrophic error for one task must not crash others
        const msg = taskErr instanceof Error ? taskErr.message : String(taskErr);
        console.error(`[autonomous-runner] Unhandled error for task ${task.id}:`, msg);

        // Best-effort: mark the task failed
        try {
          await sb
            .from("mavis_autonomous_tasks")
            .update({ status: "failed", error: `Runner error: ${msg}`, updated_at: nowIso() })
            .eq("id", task.id);
        } catch {
          // Ignore secondary failure
        }

        processed++;
      }
    }

    return json({ processed, advanced });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[autonomous-runner] Fatal error:", message);
    return json({ error: message }, 500);
  }
});
