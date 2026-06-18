// MAVIS Crew Orchestrator — parallel multi-agent synthesis engine
// Accepts a complex goal, decomposes into 2-5 specialized sub-tasks,
// runs all agents in parallel via Claude, then synthesizes a unified response.

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

interface OrchestratorResponse {
  synthesis: string;
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

  const overallStart = Date.now();
  // Stable run ID for progress streaming — clients subscribe by run_id
  const runId = crypto.randomUUID();

  // ── Step 1: Decompose ───────────────────────────────────────────────────────
  let subTasks: SubTask[];
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
    // Degrade gracefully: return raw agent outputs without synthesis
    synthesis =
      `⚠️ Synthesis step failed (${message}). Raw agent outputs are included below.\n\n` +
      agentResults
        .filter((a) => a.success)
        .map((a) => `**${a.role.toUpperCase()}:** ${a.output}`)
        .join("\n\n---\n\n");
  }

  const totalDurationMs = Date.now() - overallStart;

  // Emit synthesis progress event
  emitProgress(runId, userId, "synthesizer", "synthesis", synthesis);

  // ── Persist run (fire-and-forget) ────────────────────────────────────────────
  persistRun(userId, goal, agentResults, synthesis, totalDurationMs);

  // ── Build response ───────────────────────────────────────────────────────────
  const response: OrchestratorResponse & { run_id: string } = {
    run_id: runId,
    synthesis,
    agents: agentResults.map((r) => ({
      role: r.role,
      task: r.task,
      output: r.output,
      success: r.success,
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
