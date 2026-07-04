// MAVIS Crew Orchestrator — AI swarm engine
// PLANNER decomposes goal → specialists run in parallel → synthesizer integrates → VALIDATOR reviews.
// task_type presets bypass decomposition for known workflows (permit_roadmap, company_analysis, etc.).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Env ───────────────────────────────────────────────────────────────────────
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// OPENAI_API is a fallback env var name matching the rest of the codebase
const OPENAI_KEY = Deno.env.get("OPENAI_API") ?? "";

const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Types ─────────────────────────────────────────────────────────────────────
type AgentRole = "researcher" | "analyst" | "planner" | "critic" | "executor";

interface SubTask {
  agent: AgentRole;
  task: string;
  focus: string;
}

interface AgentResult {
  role: AgentRole;
  task: string;
  focus: string;
  output: string;
  success: boolean;
  error?: string;
  duration_ms: number;
}

interface ValidationResult {
  approved: boolean;
  score: number;           // 0–10
  suggestions: string[];
  validated_output: string; // refined synthesis incorporating suggestions
}

interface OrchestratorResponse {
  synthesis: string;
  validation: ValidationResult;
  agents: AgentResult[];
  agent_count: number;
  duration_ms: number;
}

// ── Agent persona system prompts ─────────────────────────────────────────────
const AGENT_PERSONAS: Record<AgentRole, string> = {
  researcher:
    "You are SCOUT, a research specialist. Your output: verified facts, sources, findings. Be specific and cite your reasoning.",
  analyst:
    "You are CIPHER, an analyst. Your output: patterns, insights, quantitative reasoning. Show your analysis chain.",
  planner:
    "You are COMPASS, a planner. Your output: structured plan with steps, dependencies, timeline.",
  critic:
    "You are JUDGE, a critical reviewer. Your output: risks, blind spots, alternative perspectives, quality assessment.",
  executor:
    "You are FORGE, an executor. Your output: concrete action steps, tool recommendations, implementation details.",
};

// ── Task-type presets: bypass AI decomposition for known workflow types ────────
// Maps task_type strings to a fixed agent set and goal template.
// Add new workflow types here as the swarm expands.
const TASK_TYPE_PRESETS: Record<string, (input: Record<string, string>) => SubTask[]> = {
  permit_roadmap: (inp) => [
    {
      agent: "researcher",
      task: `Research local permitting rules, zoning codes, and regulatory requirements for: ${inp.description ?? inp.location ?? "the project"}`,
      focus: "Jurisdiction-specific rules, required documents, typical timelines, fees.",
    },
    {
      agent: "analyst",
      task: `Identify rejection risks and compliance gaps for: ${inp.description ?? "the project"}`,
      focus: "Common rejection reasons, setback issues, missing reviews, mitigation strategies.",
    },
    {
      agent: "executor",
      task: `Draft professional permit application narrative for: ${inp.description ?? "the project"}`,
      focus: "First-person permit narrative, project justification, public benefit, compliance statement.",
    },
    {
      agent: "planner",
      task: `Create a step-by-step submission roadmap for: ${inp.description ?? "the project"} in ${inp.location ?? "the jurisdiction"}`,
      focus: "Ordered steps, dependencies, deadlines, contact offices, required forms.",
    },
  ],
  company_analysis: (inp) => [
    {
      agent: "researcher",
      task: `Research company background, products, leadership, and market position for: ${inp.company ?? inp.target ?? "the company"}`,
      focus: "Founding, revenue signals, key people, recent news, competitive landscape.",
    },
    {
      agent: "analyst",
      task: `Analyze strengths, weaknesses, opportunities, and threats for: ${inp.company ?? "the company"}`,
      focus: "SWOT breakdown, market share, growth signals, risk factors.",
    },
    {
      agent: "critic",
      task: `Identify red flags and risks when engaging with: ${inp.company ?? "the company"}`,
      focus: "Legal issues, financial instability, reputational risks, deal-breakers.",
    },
    {
      agent: "planner",
      task: `Recommend an engagement or partnership strategy for: ${inp.company ?? "the company"}`,
      focus: "Recommended approach, talking points, deal structure, next steps.",
    },
  ],
  content_strategy: (inp) => [
    {
      agent: "researcher",
      task: `Research audience, competitors, and trending content for: ${inp.topic ?? inp.brand ?? "the brand"}`,
      focus: "Audience demographics, competitor content gaps, trending angles, platform behavior.",
    },
    {
      agent: "analyst",
      task: `Identify highest-leverage content opportunities for: ${inp.topic ?? "the brand"}`,
      focus: "Content gaps, SEO opportunities, engagement drivers, format recommendations.",
    },
    {
      agent: "executor",
      task: `Draft a 30-day content calendar for: ${inp.topic ?? "the brand"}`,
      focus: "Post titles, formats, platforms, posting cadence, CTAs.",
    },
    {
      agent: "critic",
      task: `Review and challenge the content strategy for: ${inp.topic ?? "the brand"}`,
      focus: "Blind spots, audience misalignment, oversaturation risks, differentiation gaps.",
    },
  ],
  risk_assessment: (inp) => [
    {
      agent: "researcher",
      task: `Research known risks and historical failures related to: ${inp.subject ?? "the subject"}`,
      focus: "Prior incidents, failure modes, industry benchmarks, regulatory history.",
    },
    {
      agent: "analyst",
      task: `Quantify and rank risks for: ${inp.subject ?? "the subject"}`,
      focus: "Risk matrix (likelihood × impact), probability estimates, severity levels.",
    },
    {
      agent: "planner",
      task: `Develop mitigation strategies for the top risks in: ${inp.subject ?? "the subject"}`,
      focus: "Specific mitigations per risk, owners, monitoring triggers, contingency plans.",
    },
    {
      agent: "critic",
      task: `Challenge the risk assessment: what's being missed for: ${inp.subject ?? "the subject"}`,
      focus: "Unknown unknowns, systemic risks, tail risks, cognitive biases in the analysis.",
    },
  ],
};

// ── Default fallback tasks when decomposition fails ──────────────────────────
function buildDefaultTasks(goal: string): SubTask[] {
  return [
    {
      agent: "researcher",
      task: `Research the background, context, and relevant information needed for: ${goal}`,
      focus: "Gather facts, identify key components, surface relevant prior knowledge.",
    },
    {
      agent: "analyst",
      task: `Analyze the core requirements, constraints, and success criteria for: ${goal}`,
      focus: "Break down complexity, identify patterns, surface trade-offs and dependencies.",
    },
    {
      agent: "executor",
      task: `Define concrete action steps and implementation approach for: ${goal}`,
      focus: "Provide actionable steps, tool choices, timeline, and measurable outcomes.",
    },
  ];
}

// ── JWT auth (mirrors mavis-deep-research pattern) ───────────────────────────
async function getUserId(req: Request): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;

    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (jwtSecret) {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(jwtSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signedPart = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const sig = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const valid = await crypto.subtle.verify("HMAC", key, sig, signedPart);
      if (!valid) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(
        atob(payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)),
      );
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload.sub ?? null;
    }

    // Fallback: ask Supabase to validate the token
    const userSb = createClient(SB_URL, token, { auth: { persistSession: false } });
    const { data } = await userSb.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Raw Claude API call ──────────────────────────────────────────────────────
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

// ── Step 1: Decompose goal into sub-tasks ────────────────────────────────────
async function decomposeGoal(
  goal: string,
  context: string,
  maxAgents: number,
): Promise<SubTask[]> {
  const system =
    "You are a task decomposition engine. Break the given goal into 2-5 parallel sub-tasks, " +
    "each assigned to a specialist. Return JSON only: " +
    '{ "tasks": [{ "agent": "researcher"|"analyst"|"planner"|"critic"|"executor", ' +
    '"task": "specific sub-task description", "focus": "what this agent should produce" }] }';

  const userMsg =
    `Goal: ${goal}` +
    (context ? `\n\nContext: ${context}` : "") +
    `\n\nDecompose this into ${Math.min(maxAgents, 5)} parallel sub-tasks. Return valid JSON only.`;

  let raw: string;
  try {
    raw = await claudeCall(system, userMsg, "claude-haiku-4-5-20251001", 1024);
  } catch (err) {
    console.error("[crew-orchestrator] Decomposition Claude call failed:", err);
    return buildDefaultTasks(goal);
  }

  // Extract the JSON object from the response (robust against prose preambles)
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    console.warn("[crew-orchestrator] Could not parse decomposition JSON, using defaults");
    return buildDefaultTasks(goal);
  }

  try {
    const parsed = JSON.parse(match[0]);
    const tasks: SubTask[] = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    if (tasks.length === 0) {
      console.warn("[crew-orchestrator] Empty task list from decomposition, using defaults");
      return buildDefaultTasks(goal);
    }
    // Sanitise: only accept known agent roles
    const validRoles = new Set<AgentRole>(["researcher", "analyst", "planner", "critic", "executor"]);
    const sanitised = tasks
      .filter(
        (t) =>
          t &&
          typeof t.task === "string" &&
          typeof t.agent === "string" &&
          validRoles.has(t.agent as AgentRole),
      )
      .map((t) => ({
        agent: t.agent as AgentRole,
        task: String(t.task).slice(0, 500),
        focus: String(t.focus ?? "").slice(0, 300),
      }))
      .slice(0, 5);

    return sanitised.length > 0 ? sanitised : buildDefaultTasks(goal);
  } catch {
    console.warn("[crew-orchestrator] JSON parse error during decomposition, using defaults");
    return buildDefaultTasks(goal);
  }
}

// ── Progress event emitter (fire-and-forget) ─────────────────────────────────
function emitProgress(
  runId: string,
  userId: string,
  agentRole: string,
  eventType: "start" | "complete" | "error" | "synthesis",
  content: string,
): void {
  (async () => {
    try {
      await supabase.from("mavis_crew_progress").insert({
        run_id: runId,
        user_id: userId,
        agent_role: agentRole,
        event_type: eventType,
        content: content.slice(0, 1000),
      });
    } catch { /* non-fatal */ }
  })();
}

// ── Step 2: Run a single agent ────────────────────────────────────────────────
async function runAgent(
  subTask: SubTask,
  goal: string,
  context: string,
  runId: string,
  userId: string,
): Promise<AgentResult> {
  const agentStart = Date.now();
  const systemPrompt = AGENT_PERSONAS[subTask.agent];

  emitProgress(runId, userId, subTask.agent, "start", subTask.task);

  const userMsg =
    `MAIN GOAL: ${goal}\n\n` +
    (context ? `CONTEXT: ${context}\n\n` : "") +
    `YOUR SPECIFIC TASK: ${subTask.task}\n\n` +
    `EXPECTED OUTPUT: ${subTask.focus}\n\n` +
    "Provide a thorough, specific response in your specialist role. Be direct — no preamble.";

  try {
    const output = await claudeCall(
      systemPrompt,
      userMsg,
      "claude-haiku-4-5-20251001",
      2048,
    );
    emitProgress(runId, userId, subTask.agent, "complete", output);
    return {
      role: subTask.agent,
      task: subTask.task,
      focus: subTask.focus,
      output,
      success: true,
      duration_ms: Date.now() - agentStart,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[crew-orchestrator] Agent ${subTask.agent} failed:`, message);
    emitProgress(runId, userId, subTask.agent, "error", message);
    return {
      role: subTask.agent,
      task: subTask.task,
      focus: subTask.focus,
      output: "",
      success: false,
      error: message,
      duration_ms: Date.now() - agentStart,
    };
  }
}

// ── Step 3: Synthesise all agent outputs ──────────────────────────────────────
async function synthesise(
  goal: string,
  context: string,
  agentResults: AgentResult[],
): Promise<string> {
  const successfulAgents = agentResults.filter((a) => a.success);

  if (successfulAgents.length === 0) {
    throw new Error("All agents failed — cannot synthesise");
  }

  const agentSection = successfulAgents
    .map(
      (a) =>
        `### ${a.role.toUpperCase()} (${a.role === "researcher" ? "SCOUT" : a.role === "analyst" ? "CIPHER" : a.role === "planner" ? "COMPASS" : a.role === "critic" ? "JUDGE" : "FORGE"})\n` +
        `Task: ${a.task}\n\n${a.output}`,
    )
    .join("\n\n---\n\n");

  const system =
    "You are the MAVIS synthesis engine. You receive outputs from multiple specialist agents " +
    "and produce a unified, coherent final answer. Integrate all perspectives. Be comprehensive " +
    "yet concise. Structure your response clearly with sections where appropriate.";

  const userMsg =
    `GOAL: ${goal}\n\n` +
    (context ? `CONTEXT: ${context}\n\n` : "") +
    `SPECIALIST AGENT OUTPUTS:\n\n${agentSection}\n\n` +
    "Synthesize these into the definitive response:";

  return claudeCall(system, userMsg, "claude-sonnet-4-6", 4096);
}

// ── Fire-and-forget: persist run to mavis_crew_runs ──────────────────────────
function persistRun(
  userId: string,
  goal: string,
  agentResults: AgentResult[],
  synthesis: string,
  durationMs: number,
): void {
  // Intentionally non-blocking — errors here must never affect the response
  (async () => {
    try {
      await supabase.from("mavis_crew_runs").insert({
        user_id: userId,
        goal,
        agent_count: agentResults.length,
        agent_results: agentResults,
        synthesis,
        duration_ms: durationMs,
      });
    } catch (err) {
      // Non-fatal: log and move on
      console.error("[crew-orchestrator] Failed to persist run:", err);
    }
  })();
}

// ── Step 4: Validator — reviews synthesis, returns score + refined output ─────
async function validate(
  goal: string,
  synthesis: string,
  agentResults: AgentResult[],
): Promise<ValidationResult> {
  const system =
    "You are VANTARA VALIDATOR, the final quality gate of the MAVIS swarm. " +
    "You receive a synthesized answer produced by a multi-agent crew and evaluate it " +
    "for completeness, accuracy, actionability, and internal consistency. " +
    "Return JSON only — no prose outside the JSON object: " +
    '{ "approved": boolean, "score": 0-10, "suggestions": ["..."], "validated_output": "refined answer here" }. ' +
    "If approved (score >= 7), validated_output should be the synthesis with any small improvements inline. " +
    "If not approved (score < 7), validated_output should be a clearly improved rewrite.";

  const agentSummary = agentResults
    .filter((a) => a.success)
    .map((a) => `[${a.role.toUpperCase()}]: ${a.output.slice(0, 400)}`)
    .join("\n\n");

  const userMsg =
    `GOAL: ${goal}\n\n` +
    `AGENT OUTPUTS (summary):\n${agentSummary}\n\n` +
    `SYNTHESIZED ANSWER:\n${synthesis}\n\n` +
    "Evaluate and return JSON.";

  try {
    const raw = await claudeCall(system, userMsg, "claude-haiku-4-5-20251001", 2048);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in validator response");
    const parsed = JSON.parse(match[0]);
    return {
      approved: Boolean(parsed.approved),
      score: Math.min(10, Math.max(0, Number(parsed.score ?? 7))),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [],
      validated_output: String(parsed.validated_output ?? synthesis),
    };
  } catch (err) {
    console.warn("[crew-orchestrator] Validator failed, using synthesis as-is:", err);
    return { approved: true, score: 7, suggestions: [], validated_output: synthesis };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const userId = await getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Guard: must have at least one LLM provider ───────────────────────────
  if (!ANTHROPIC_KEY && !OPENAI_KEY) {
    return new Response(
      JSON.stringify({
        error: "No LLM provider configured. Set ANTHROPIC_API_KEY (required) or OPENAI_API.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!ANTHROPIC_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is required for the crew orchestrator." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const goal = String(body.goal ?? "").trim();
  if (!goal) {
    return new Response(JSON.stringify({ error: '"goal" is required' }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const context = String(body.context ?? "").trim();
  const rawMax = Number(body.max_agents ?? 5);
  const maxAgents = Math.max(2, Math.min(5, isNaN(rawMax) ? 5 : rawMax));
  // task_type triggers a preset agent set rather than AI decomposition
  const taskType = String(body.task_type ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  // input object for preset templates (mirrors the Node.js script's task.input shape)
  const taskInput: Record<string, string> = typeof body.input === "object" && body.input !== null
    ? Object.fromEntries(Object.entries(body.input as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    : {};

  const overallStart = Date.now();
  // Stable run ID for progress streaming — clients subscribe by run_id
  const runId = crypto.randomUUID();

  // ── Step 1: Decompose (or use preset) ──────────────────────────────────────
  let subTasks: SubTask[];
  const presetFn = TASK_TYPE_PRESETS[taskType];
  if (presetFn) {
    // Known workflow: use preset agent set — skip AI decomposition
    subTasks = presetFn({ ...taskInput, _goal: goal });
    emitProgress(runId, userId, "planner", "start", `Using preset: ${taskType}`);
    emitProgress(runId, userId, "planner", "complete", `${subTasks.length} agents assigned`);
  } else {
    try {
      subTasks = await decomposeGoal(goal, context, maxAgents);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[crew-orchestrator] Fatal decomposition error:", message);
      return new Response(JSON.stringify({ error: `Goal decomposition failed: ${message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ── Step 2: Parallel agent execution ────────────────────────────────────────
  const agentResults: AgentResult[] = await Promise.all(
    subTasks.map((task) => runAgent(task, goal, context, runId, userId)),
  );

  // Hard failure: every single agent failed
  const successCount = agentResults.filter((r) => r.success).length;
  if (successCount === 0) {
    const errors = agentResults.map((r) => `${r.role}: ${r.error ?? "unknown"}`).join("; ");
    return new Response(
      JSON.stringify({
        error: "All agents failed",
        detail: errors,
        agents: agentResults,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Step 3: Synthesis ────────────────────────────────────────────────────────
  let synthesis: string;
  try {
    synthesis = await synthesise(goal, context, agentResults);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[crew-orchestrator] Synthesis failed:", message);
    synthesis =
      `⚠️ Synthesis step failed (${message}). Raw agent outputs are included below.\n\n` +
      agentResults
        .filter((a) => a.success)
        .map((a) => `**${a.role.toUpperCase()}:** ${a.output}`)
        .join("\n\n---\n\n");
  }

  // Emit synthesis progress event
  emitProgress(runId, userId, "synthesizer", "synthesis", synthesis);

  // ── Step 4: Validate ─────────────────────────────────────────────────────────
  emitProgress(runId, userId, "validator", "start", "Running quality validation");
  const validation = await validate(goal, synthesis, agentResults);
  emitProgress(runId, userId, "validator", "complete",
    `Score: ${validation.score}/10 — ${validation.approved ? "APPROVED" : "NEEDS WORK"}`);

  const totalDurationMs = Date.now() - overallStart;

  // ── Persist run (fire-and-forget) ────────────────────────────────────────────
  persistRun(userId, goal, agentResults, validation.validated_output, totalDurationMs);

  // ── Build response ───────────────────────────────────────────────────────────
  const response: OrchestratorResponse & { run_id: string; task_type: string } = {
    run_id: runId,
    task_type: taskType || "auto",
    synthesis: validation.validated_output,  // use validator-refined output
    validation,
    agents: agentResults.map((r) => ({
      role: r.role,
      task: r.task,
      output: r.output,
      success: r.success,
      duration_ms: r.duration_ms,
      ...(r.error ? { error: r.error } : {}),
    })) as AgentResult[],
    agent_count: agentResults.length,
    duration_ms: totalDurationMs,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
