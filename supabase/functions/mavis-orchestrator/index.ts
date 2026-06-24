// mavis-orchestrator
// Multi-agent coordination: breaks complex goals into specialist sub-tasks,
// executes them in dependency order (parallel where possible) through
// mavis-agent with domain-specific prompts, then synthesizes results.
//
// Actions: run | plan_only
// Use for goals spanning multiple domains where a single agent loop would be
// too slow or context-heavy.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SubTask {
  id:         string;
  domain:     "email" | "calendar" | "drive" | "research" | "tasks" | "memory" | "general";
  goal:       string;
  priority:   number;
  depends_on: string[];
}

interface PlanResult {
  subtasks:       SubTask[];
  synthesis_goal: string;
}

// ── Planner: Claude decomposes the goal into sub-tasks ────────────────────────
async function planGoal(goal: string): Promise<PlanResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":          ANTHROPIC_KEY,
      "anthropic-version":  "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are the MAVIS Orchestrator Planner. Break the goal into 2–5 concrete sub-tasks for specialist agents. Prefer parallel execution — only add depends_on when a task truly needs another's output.

Domains:
- email:    read, search, draft via Gmail
- calendar: read events, create/modify calendar entries
- drive:    search, read, create, or edit Drive files/Docs/Sheets
- research: web search for current information
- tasks:    create tasks, update quests, set reminders
- memory:   recall or save context across sessions
- general:  analysis, reasoning, cross-domain synthesis

Return ONLY valid JSON — no prose, no markdown:
{
  "subtasks": [
    {
      "id": "task_1",
      "domain": "email",
      "goal": "specific actionable goal for this agent",
      "priority": 1,
      "depends_on": []
    }
  ],
  "synthesis_goal": "One sentence: what to tell the operator after completion"
}`,
      messages: [{ role: "user", content: goal }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Planner error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const raw  = (data.content as Array<{ type: string; text?: string }>)
    ?.find((b) => b.type === "text")?.text ?? "{}";

  try {
    const clean = raw.replace(/^```[a-z]*\n?/m, "").replace(/\n?```$/m, "").trim();
    return JSON.parse(clean) as PlanResult;
  } catch {
    return {
      subtasks:       [{ id: "task_1", domain: "general", goal, priority: 1, depends_on: [] }],
      synthesis_goal: "Summarize what was accomplished and what the operator needs to know.",
    };
  }
}

// ── Domain preambles: guide each specialist agent ─────────────────────────────
const DOMAIN_PREAMBLES: Record<string, string> = {
  email:    "You are MAVIS email specialist. Think first, then read inbox, search emails, draft replies via queue_action(draft_email). Save key context to memory.",
  calendar: "You are MAVIS calendar specialist. Think first, then read events, find conflicts, create entries via queue_action(schedule_event).",
  drive:    "You are MAVIS Drive specialist. Think first, then use search_drive, read_drive_file, read_sheet_range, and create/update files via queue_action.",
  research: "You are MAVIS research specialist. Think first, then use search_web to gather accurate, current information. Synthesize findings clearly.",
  tasks:    "You are MAVIS task specialist. Think first, then create tasks and note deadlines via queue_action(create_task).",
  memory:   "You are MAVIS memory specialist. Use recall_memory to surface relevant context, then save_memory for important new learnings.",
  general:  "You are MAVIS. Think first using the think tool, then use all available tools to accomplish this goal efficiently and thoroughly.",
};

// ── Specialist executor ────────────────────────────────────────────────────────
async function runSubTask(
  subtask:      SubTask,
  userId:       string,
  priorContext: string,
): Promise<{ id: string; domain: string; result: string; ok: boolean; actionsQueued: number }> {
  const preamble     = DOMAIN_PREAMBLES[subtask.domain] ?? DOMAIN_PREAMBLES.general;
  const contextBlock = priorContext
    ? `\n\nCONTEXT FROM COMPLETED STEPS:\n${priorContext}`
    : "";

  const specialistGoal = `${preamble}\n\nYOUR SPECIFIC TASK: ${subtask.goal}${contextBlock}\n\nBe specific and thorough. Report exactly what you did and flag anything needing operator attention.`;

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ user_id: userId, goal: specialistGoal, mode: "ORCHESTRATED" }),
      signal: AbortSignal.timeout(120_000),
    });

    const data = res.ok ? await res.json() : {};
    return {
      id:            subtask.id,
      domain:        subtask.domain,
      result:        String(data.content ?? "No result returned"),
      ok:            res.ok,
      actionsQueued: Number(data.actionsQueued ?? 0),
    };
  } catch (err) {
    return {
      id:            subtask.id,
      domain:        subtask.domain,
      result:        err instanceof Error ? err.message : String(err),
      ok:            false,
      actionsQueued: 0,
    };
  }
}

// ── Synthesizer: unify all sub-task results ───────────────────────────────────
async function synthesizeResults(
  results:       Array<{ id: string; domain: string; result: string; ok: boolean }>,
  synthesisGoal: string,
  originalGoal:  string,
): Promise<string> {
  const resultsText = results
    .map((r) => `[${r.domain.toUpperCase()} — ${r.ok ? "✓" : "✗ failed"}]\n${r.result}`)
    .join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":          ANTHROPIC_KEY,
      "anthropic-version":  "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 512,
      system: "You are MAVIS. Synthesize specialist agent results into one concise, actionable operator summary: what was completed, what actions need approval, any issues. Direct and specific — no filler.",
      messages: [{
        role:    "user",
        content: `Original goal: ${originalGoal}\n\nSpecialist results:\n${resultsText}\n\nSynthesis directive: ${synthesisGoal}`,
      }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) return resultsText;

  const data = await res.json();
  return (data.content as Array<{ type: string; text?: string }>)
    ?.find((b) => b.type === "text")?.text ?? resultsText;
}

// ── Main handler ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const authHeader = req.headers.get("authorization") ?? "";
    const token      = authHeader.replace(/^Bearer\s+/i, "").trim();
    const body       = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action     = String(body.action ?? "run");

    let userId = String((body.user_id ?? body.userId) ?? "").trim();
    if (!userId && token && token !== SERVICE_ROLE_KEY) {
      const userSb = createClient(SUPABASE_URL, token, { auth: { persistSession: false } });
      const { data: { user } } = await userSb.auth.getUser();
      userId = user?.id ?? "";
    }

    const goal = String(body.goal ?? "").trim();
    if (!goal)   return json({ ok: false, error: "goal required" }, 400);
    if (!userId) return json({ ok: false, error: "user_id or valid JWT required" }, 401);

    // ── Plan ─────────────────────────────────────────────────────────────────
    const plan     = await planGoal(goal);
    const subtasks = plan.subtasks ?? [];

    if (action === "plan_only") {
      return json({ ok: true, goal, plan: subtasks, synthesis_goal: plan.synthesis_goal });
    }

    if (subtasks.length === 0) return json({ ok: false, error: "Planner returned no subtasks" }, 500);

    // ── Execute in dependency waves ───────────────────────────────────────────
    const completed       = new Map<string, { id: string; domain: string; result: string; ok: boolean; actionsQueued: number }>();
    let   totalQueued     = 0;
    const done            = new Set<string>();
    let   maxWaves        = 5;

    const getReadyWave = (tasks: SubTask[], doneSet: Set<string>): SubTask[] =>
      tasks.filter((t) => !doneSet.has(t.id) && t.depends_on.every((d) => doneSet.has(d)));

    while (done.size < subtasks.length && maxWaves-- > 0) {
      const wave = getReadyWave(subtasks, done);
      if (wave.length === 0) break; // circular dep guard

      // Build context from previously completed tasks for dependent waves
      const priorContext = wave.some((t) => t.depends_on.length > 0)
        ? Array.from(completed.values())
            .map((r) => `[${r.domain}] ${r.result.slice(0, 400)}`)
            .join("\n")
        : "";

      const waveResults = await Promise.all(wave.map((t) => runSubTask(t, userId, priorContext)));

      for (const r of waveResults) {
        completed.set(r.id, r);
        done.add(r.id);
        totalQueued += r.actionsQueued;
      }
    }

    const allResults = Array.from(completed.values());

    // ── Synthesize ────────────────────────────────────────────────────────────
    const summary = await synthesizeResults(allResults, plan.synthesis_goal, goal);

    // Log orchestration run
    await adminSb.from("mavis_trigger_log").insert({
      user_id:         userId,
      trigger_types:   ["orchestration"],
      context_summary: goal.slice(0, 500),
      agent_response:  summary.slice(0, 1000),
      actions_auto:    0,
      actions_queued:  totalQueued,
    }).catch(() => {});

    return json({
      ok:             true,
      goal,
      subtasks_count: allResults.length,
      plan:           subtasks.map((t) => ({ id: t.id, domain: t.domain, goal: t.goal })),
      results:        allResults.map((r) => ({ id: r.id, domain: r.domain, ok: r.ok, actionsQueued: r.actionsQueued })),
      actions_queued: totalQueued,
      summary,
    });

  } catch (err) {
    console.error("[mavis-orchestrator]", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
