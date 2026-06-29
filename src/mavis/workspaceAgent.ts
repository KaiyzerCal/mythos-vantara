/**
 * Workspace Agent — Antigravity Agent Manager pattern for MAVIS.
 *
 * Implements Antigravity's core multi-agent architecture:
 *   Agent Manager  = this module (WorkspaceCoordinator)
 *   Agent instance = EphemeralAgent from dynamicAgentFactory
 *   Inbox          = pending_ops queue in mavis_workspace_sessions
 *   Artifacts      = structured deliverables (plans, diffs, screenshots)
 *   Skills         = semantically loaded instruction sets per task
 *   Workflows      = slash-command triggered multi-step pipelines
 *
 * Parallel agents share workspace context but have isolated conversation
 * histories. Terminal commands and file writes are gated by execution policy:
 *   allow_all      — agent executes without review
 *   request_review — op queued in Inbox, blocked until operator approves
 *   deny           — operation rejected immediately
 *
 * LocalMesh proxy routes file I/O and terminal execution to the
 * local environment (Ollama companion service exposes /terminal, /fs).
 */

import { supabase } from "@/integrations/supabase/client";
import { storeMemory } from "@/mavis/agentMemoryEngine";
import { sendMessage, broadcastToAll } from "@/mavis/interAgentBus";
import { dispatchAgent, type AgentSpecialization } from "@/mavis/dynamicAgentFactory";
import { toolRegistry } from "@/mavis/toolRegistry";
import { getLocalMeshConfig } from "@/mavis/localMesh";
import { getAllSkills } from "@/mavis/skills/_registry";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TerminalPolicy = "allow_all" | "request_review" | "deny";
export type FilePolicy     = "allow_all" | "allow_read" | "deny";
export type BrowserPolicy  = "allow_all" | "headless_only" | "deny";

export interface WorkspaceSession {
  id: string;
  userId: string;
  sessionName: string;
  workspacePath?: string;
  agents: WorkspaceAgentSlot[];
  activeAgentId?: string;
  terminalPolicy: TerminalPolicy;
  filePolicy: FilePolicy;
  browserPolicy: BrowserPolicy;
  pendingOps: PendingOp[];
  completedOps: CompletedOp[];
  status: "active" | "paused" | "completed" | "failed";
  summary?: string;
}

export interface WorkspaceAgentSlot {
  id: string;
  name: string;
  specialization: AgentSpecialization;
  status: "idle" | "running" | "waiting_approval" | "complete" | "failed";
  currentTask?: string;
  lastArtifact?: Artifact;
}

export interface PendingOp {
  id: string;
  agentId: string;
  agentName: string;
  type: "terminal" | "file_write" | "browser" | "mcp_call";
  command: string;
  context: string;
  requestedAt: string;
}

export interface CompletedOp {
  id: string;
  agentId: string;
  type: PendingOp["type"];
  command: string;
  approved: boolean;
  result?: string;
  completedAt: string;
}

// Artifacts = structured deliverables surfaced from agent work
export interface Artifact {
  id: string;
  type: "task_plan" | "implementation_plan" | "code_diff" | "screenshot" | "walkthrough" | "report";
  title: string;
  content: string;                        // markdown body
  agentId: string;
  agentName: string;
  sessionId: string;
  createdAt: string;
  requiresReview?: boolean;               // gates execution in Inbox
}

// Skills = semantically loaded instruction sets (Antigravity SKILL.md pattern)
export interface AgentSkill {
  name: string;
  description: string;                    // used for semantic selection
  instructions: string;                   // markdown injected into system prompt
  toolCategories?: string[];              // restrict tool access
  triggers?: string[];                    // keyword triggers for explicit matching
}

// Workflows = slash-command triggered pipelines (.agents/workflows/*.md pattern)
export interface AgentWorkflow {
  name: string;                           // slash command name (e.g. "deploy")
  description: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  description: string;
  agentSpecialization: AgentSpecialization;
  instructions: string;
  dependsOn?: string[];                   // step IDs that must complete first
  approvalRequired?: boolean;
}

// ── Built-in skills (shipped with MAVIS) ─────────────────────────────────────

const MAVIS_SKILLS: AgentSkill[] = [
  {
    name: "deep-research",
    description: "Systematic research using web search, memory recall, and source verification. Use when asked to research a topic, gather information, or produce an evidence-based report.",
    instructions: `You are conducting systematic research. Follow this protocol:
1. Formulate 3–5 specific search queries covering different angles of the topic
2. Use web_search for each query; note source URLs and key claims
3. Verify primary claims using verify_claim for high-stakes facts
4. Cross-reference findings across sources; flag contradictions
5. Synthesize into a structured report with: Summary, Key Findings, Evidence, Sources, Gaps
6. Store significant findings in long-term memory with importance ≥ 7`,
    toolCategories: ["api", "analysis"],
    triggers: ["research", "investigate", "find out", "gather information"],
  },
  {
    name: "code-review",
    description: "Structured code review with quality, security, and performance analysis. Use when asked to review, audit, or evaluate code.",
    instructions: `Perform a structured code review across four dimensions:
1. **Correctness** — logic errors, edge cases, off-by-one errors
2. **Security** — injection vulnerabilities, exposed secrets, OWASP top 10
3. **Performance** — unnecessary re-renders, N+1 queries, blocking operations
4. **Maintainability** — naming clarity, complexity, test coverage gaps
Format findings as: [SEVERITY: critical|high|medium|low] File:Line — Description`,
    toolCategories: ["analysis"],
    triggers: ["review", "audit", "check code", "evaluate"],
  },
  {
    name: "task-decomposer",
    description: "Break complex goals into ordered, parallelisable sub-tasks with clear success criteria. Use when planning a multi-step implementation or project.",
    instructions: `Decompose the goal into an ordered task graph:
1. Identify atomic units of work (each completable in <30 min)
2. Map dependencies (what must happen before what)
3. Flag tasks that can run in parallel
4. Assign specialization (researcher/writer/executor/analyst) to each task
5. Define explicit success criteria for each task
Output as a structured plan with: Task ID, Description, Specialization, Depends On, Success Criteria`,
    toolCategories: ["analysis"],
    triggers: ["plan", "decompose", "break down", "project plan"],
  },
  {
    name: "knowledge-capture",
    description: "Extract and preserve key insights, decisions, and learnings from completed work. Use after completing a significant task or analysis.",
    instructions: `After completing the task, systematically capture learnings:
1. What was the core problem or question?
2. What key decisions were made and why?
3. What surprised you or contradicted prior expectations?
4. What patterns or principles emerged?
5. What should future agents know before tackling similar work?
Store each insight as a semantic memory with importance ≥ 6 and wikilinks to relevant topics.`,
    toolCategories: ["analysis"],
    triggers: ["capture", "document learnings", "preserve insights"],
  },
  {
    name: "market-intelligence",
    description: "Gather and synthesize market data, competitor intelligence, and trend analysis. Use for trading signals, business intelligence, or market research.",
    instructions: `Conduct structured market intelligence gathering:
1. Identify the market/sector and key participants
2. Search for recent news, earnings reports, and analyst opinions
3. Look for macro factors (Fed policy, sector rotation, geopolitical events)
4. Quantify where possible: prices, volumes, ratios
5. Synthesize into: Market Overview, Bullish Signals, Bearish Signals, Key Risks, Recommendation
Cite sources and timestamps for all data points.`,
    toolCategories: ["api", "analysis"],
    triggers: ["market", "trading", "intelligence", "financial analysis"],
  },
];

// ── Built-in workflows ────────────────────────────────────────────────────────

const MAVIS_WORKFLOWS: AgentWorkflow[] = [
  {
    name: "research-and-report",
    description: "Full research pipeline: gather sources → verify facts → synthesize → write report → capture learnings",
    steps: [
      {
        id: "gather",
        description: "Gather raw information from web and memory",
        agentSpecialization: "researcher",
        instructions: "Use web_search and recall_memories to gather information on the topic. Collect at least 8 distinct sources.",
      },
      {
        id: "verify",
        description: "Verify key claims against live sources",
        agentSpecialization: "analyst",
        instructions: "Take the top 5 claims from the research and verify each with verify_claim. Document verdict and evidence.",
        dependsOn: ["gather"],
      },
      {
        id: "synthesize",
        description: "Write the final report",
        agentSpecialization: "writer",
        instructions: "Synthesize the verified research into a structured report: Executive Summary, Findings, Evidence, Recommendations.",
        dependsOn: ["verify"],
      },
    ],
  },
  {
    name: "market-scan",
    description: "Automated market intelligence scan: price data → news → signals → report",
    steps: [
      {
        id: "data",
        description: "Fetch current market data",
        agentSpecialization: "trader",
        instructions: "Gather current prices, volume, and key metrics for the target assets.",
      },
      {
        id: "news",
        description: "Gather relevant market news",
        agentSpecialization: "researcher",
        instructions: "Search for recent news, analyst opinions, and macro events affecting the target market.",
        dependsOn: ["data"],
      },
      {
        id: "signals",
        description: "Generate trade signals",
        agentSpecialization: "analyst",
        instructions: "Analyse price data + news context. Output structured signals: asset, direction, confidence, rationale.",
        dependsOn: ["data", "news"],
      },
    ],
  },
  {
    name: "knowledge-build",
    description: "Build a knowledge note from a topic: research → distill → write Obsidian note",
    steps: [
      {
        id: "research",
        description: "Deep research on the topic",
        agentSpecialization: "researcher",
        instructions: "Perform systematic research using deep-research skill. Collect all key facts, concepts, and sources.",
      },
      {
        id: "note",
        description: "Write knowledge note",
        agentSpecialization: "writer",
        instructions: "Transform research into a structured knowledge note with frontmatter, wikilinks, and tags. Store in long-term memory.",
        dependsOn: ["research"],
      },
    ],
  },
];

// ── Skill selector (semantic matching) ───────────────────────────────────────

function selectSkills(task: string, availableSkills?: AgentSkill[]): AgentSkill[] {
  // Merge built-in skills with any DB runtime skills (keyword + description match)
  if (!availableSkills) {
    const dbDefs = getAllSkills();
    const builtinNames = new Set(MAVIS_SKILLS.map(s => s.name));
    const runtimeSkills: AgentSkill[] = dbDefs
      .filter(d => !builtinNames.has(d.name))
      .map(d => ({
        name: d.name,
        description: d.description,
        triggers: d.keywords,
        instructions: d.description,
      }));
    availableSkills = [...MAVIS_SKILLS, ...runtimeSkills];
  }
  const taskLower = task.toLowerCase();

  // Direct keyword trigger match
  const triggered = availableSkills.filter(skill =>
    skill.triggers?.some(t => taskLower.includes(t.toLowerCase()))
  );
  if (triggered.length) return triggered.slice(0, 2); // cap at 2 skills

  // Fallback: description token overlap (poor-man's semantic match)
  const scored = availableSkills.map(skill => {
    const descWords = skill.description.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const taskWords = taskLower.split(/\s+/);
    const overlap = descWords.filter(w => taskWords.some(tw => tw.includes(w) || w.includes(tw))).length;
    return { skill, score: overlap / Math.max(descWords.length, 1) };
  });

  return scored
    .filter(s => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(s => s.skill);
}

// ── LocalMesh command executor ────────────────────────────────────────────────

interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function executeViaLocalMesh(
  type: "terminal" | "file_read" | "file_write",
  payload: Record<string, unknown>
): Promise<{ success: boolean; output: string }> {
  const cfg = getLocalMeshConfig();
  if (!cfg.enabled) return { success: false, output: "LocalMesh not enabled" };

  const base = cfg.tunnelEnabled && cfg.tunnelUrl ? cfg.tunnelUrl : cfg.endpoint;

  try {
    const endpoint = type === "terminal" ? "/terminal"
      : type === "file_read"  ? "/fs/read"
      : "/fs/write";

    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return { success: false, output: `LocalMesh HTTP ${res.status}` };
    const data = await res.json() as { stdout?: string; content?: string; error?: string; exitCode?: number };

    const output = data.stdout ?? data.content ?? data.error ?? "";
    const success = (data.exitCode ?? 0) === 0 && !data.error;
    return { success, output: output.slice(0, 4000) };
  } catch (err) {
    return { success: false, output: (err as Error).message };
  }
}

// ── Inbox (pending ops queue) ─────────────────────────────────────────────────

async function queuePendingOp(
  sessionId: string,
  userId: string,
  op: Omit<PendingOp, "id" | "requestedAt">
): Promise<PendingOp> {
  const pendingOp: PendingOp = {
    ...op,
    id: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
  };

  const { data: session } = await supabase
    .from("mavis_workspace_sessions")
    .select("pending_ops")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single()
    .catch(() => ({ data: null }));

  const existing = (session?.pending_ops as PendingOp[]) ?? [];
  await supabase.from("mavis_workspace_sessions").update({
    pending_ops: [...existing, pendingOp],
    updated_at: new Date().toISOString(),
  }).eq("id", sessionId).catch(() => {/* non-fatal */});

  return pendingOp;
}

async function resolveOp(
  sessionId: string,
  userId: string,
  opId: string,
  approved: boolean,
  result?: string
): Promise<void> {
  const { data: session } = await supabase
    .from("mavis_workspace_sessions")
    .select("pending_ops, completed_ops")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single()
    .catch(() => ({ data: null }));

  if (!session) return;

  const pending = (session.pending_ops as PendingOp[]) ?? [];
  const completed = (session.completed_ops as CompletedOp[]) ?? [];
  const op = pending.find(p => p.id === opId);
  if (!op) return;

  const resolvedOp: CompletedOp = {
    id: op.id,
    agentId: op.agentId,
    type: op.type,
    command: op.command,
    approved,
    result,
    completedAt: new Date().toISOString(),
  };

  await supabase.from("mavis_workspace_sessions").update({
    pending_ops: pending.filter(p => p.id !== opId),
    completed_ops: [...completed, resolvedOp],
    updated_at: new Date().toISOString(),
  }).eq("id", sessionId).catch(() => {/* non-fatal */});
}

// ── Artifact registry ─────────────────────────────────────────────────────────

const _artifacts = new Map<string, Artifact[]>(); // sessionId → Artifact[]

function recordArtifact(sessionId: string, artifact: Omit<Artifact, "id" | "createdAt">): Artifact {
  const full: Artifact = {
    ...artifact,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const existing = _artifacts.get(sessionId) ?? [];
  _artifacts.set(sessionId, [...existing, full]);
  return full;
}

function getArtifacts(sessionId: string): Artifact[] {
  return _artifacts.get(sessionId) ?? [];
}

// ── WorkspaceCoordinator ──────────────────────────────────────────────────────

class WorkspaceCoordinator {
  private sessions = new Map<string, WorkspaceSession>(); // sessionId → session

  /** Create and persist a new workspace session */
  async createSession(
    userId: string,
    sessionName: string,
    options?: {
      workspacePath?: string;
      terminalPolicy?: TerminalPolicy;
      filePolicy?: FilePolicy;
      browserPolicy?: BrowserPolicy;
    }
  ): Promise<WorkspaceSession> {
    const { data, error } = await supabase
      .from("mavis_workspace_sessions")
      .insert({
        user_id: userId,
        session_name: sessionName,
        workspace_path: options?.workspacePath ?? null,
        terminal_policy: options?.terminalPolicy ?? "request_review",
        file_policy: options?.filePolicy ?? "allow_read",
        browser_policy: options?.browserPolicy ?? "allow_all",
        agents: [],
        pending_ops: [],
        completed_ops: [],
        status: "active",
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create workspace session: ${error.message}`);

    const session: WorkspaceSession = {
      id: data.id,
      userId,
      sessionName,
      workspacePath: options?.workspacePath,
      agents: [],
      terminalPolicy: options?.terminalPolicy ?? "request_review",
      filePolicy: options?.filePolicy ?? "allow_read",
      browserPolicy: options?.browserPolicy ?? "allow_all",
      pendingOps: [],
      completedOps: [],
      status: "active",
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /** Spawn an agent into the session (max 5 parallel, mirrors Antigravity limit) */
  async spawnAgent(
    session: WorkspaceSession,
    task: string,
    specialization?: AgentSpecialization,
    agentName?: string
  ): Promise<WorkspaceAgentSlot> {
    if (session.agents.filter(a => a.status === "running").length >= 5) {
      throw new Error("Maximum 5 parallel agents per workspace session");
    }

    // Select relevant skills based on task semantics
    const skills = selectSkills(task);
    const skillContext = skills.length
      ? `\n\n## Active Skills\n${skills.map(s => `### ${s.name}\n${s.instructions}`).join("\n\n")}`
      : "";

    const spec = specialization ?? inferSpecialization(task);
    const name = agentName ?? `${spec}-${Date.now().toString(36)}`;

    const slot: WorkspaceAgentSlot = {
      id: crypto.randomUUID(),
      name,
      specialization: spec,
      status: "running",
      currentTask: task,
    };

    session.agents.push(slot);
    await this._persistAgents(session);

    // Generate task plan artifact before executing
    const plan = await this._generateTaskPlan(task, spec, skills);
    const planArtifact = recordArtifact(session.id, {
      type: "task_plan",
      title: `Task Plan: ${task.slice(0, 60)}`,
      content: plan,
      agentId: slot.id,
      agentName: name,
      sessionId: session.id,
      requiresReview: false,
    });
    slot.lastArtifact = planArtifact;

    // Run the agent asynchronously (non-blocking)
    this._runAgentTask(session, slot, task, skillContext).catch(err => {
      console.error(`[WorkspaceAgent] Agent ${name} failed:`, err);
      slot.status = "failed";
      this._persistAgents(session);
    });

    return slot;
  }

  /** Execute a terminal command respecting the session's terminal policy */
  async runTerminalCommand(
    session: WorkspaceSession,
    agentId: string,
    agentName: string,
    command: string,
    context: string
  ): Promise<{ approved: boolean; result?: string }> {
    if (session.terminalPolicy === "deny") {
      return { approved: false, result: "Terminal access denied by session policy" };
    }

    if (session.terminalPolicy === "request_review") {
      const op = await queuePendingOp(session.id, session.userId, {
        agentId, agentName, type: "terminal", command, context,
      });
      session.pendingOps.push(op);

      // Notify operator via inter-agent bus
      await broadcastToAll({
        fromId: agentId,
        fromName: agentName,
        fromType: "plugin",
      }, {
        intent: "SIGNAL",
        payload: {
          signal: "APPROVAL_REQUIRED",
          opId: op.id,
          sessionId: session.id,
          type: "terminal",
          command,
        },
        ttl: 300,
      }, session.userId).catch(() => {/* non-fatal */});

      return { approved: false, result: `Queued for operator review (op: ${op.id})` };
    }

    // allow_all — execute immediately via LocalMesh
    const result = await executeViaLocalMesh("terminal", {
      command,
      workspacePath: session.workspacePath,
    });

    await resolveOp(session.id, session.userId, crypto.randomUUID(), true, result.output);
    return { approved: true, result: result.output };
  }

  /** Read a file from the workspace */
  async readFile(
    session: WorkspaceSession,
    filePath: string
  ): Promise<{ success: boolean; content: string }> {
    if (session.filePolicy === "deny") {
      return { success: false, content: "File access denied by session policy" };
    }

    const result = await executeViaLocalMesh("file_read", {
      path: filePath,
      workspacePath: session.workspacePath,
    });

    return { success: result.success, content: result.output };
  }

  /** Write a file, respecting the file policy */
  async writeFile(
    session: WorkspaceSession,
    agentId: string,
    agentName: string,
    filePath: string,
    content: string
  ): Promise<{ approved: boolean; result?: string }> {
    if (session.filePolicy === "deny" || session.filePolicy === "allow_read") {
      if (session.filePolicy === "deny") {
        return { approved: false, result: "File write denied by session policy" };
      }
      // allow_read → queue for review
      const op = await queuePendingOp(session.id, session.userId, {
        agentId, agentName, type: "file_write",
        command: `Write ${content.length} chars to ${filePath}`,
        context: content.slice(0, 500),
      });
      session.pendingOps.push(op);
      return { approved: false, result: `Queued for operator review (op: ${op.id})` };
    }

    const result = await executeViaLocalMesh("file_write", { path: filePath, content });
    return { approved: true, result: result.output };
  }

  /** Approve a pending op from the Inbox */
  async approvePendingOp(
    session: WorkspaceSession,
    opId: string
  ): Promise<{ executed: boolean; result?: string }> {
    const op = session.pendingOps.find(p => p.id === opId);
    if (!op) return { executed: false };

    let result: string | undefined;
    if (op.type === "terminal") {
      const r = await executeViaLocalMesh("terminal", {
        command: op.command,
        workspacePath: session.workspacePath,
      });
      result = r.output;
    } else if (op.type === "file_write") {
      const r = await executeViaLocalMesh("file_write", {
        path: op.command.split("to ")[1] ?? op.command,
        content: op.context,
      });
      result = r.output;
    }

    await resolveOp(session.id, session.userId, opId, true, result);
    session.pendingOps = session.pendingOps.filter(p => p.id !== opId);
    return { executed: true, result };
  }

  /** Deny a pending op */
  async denyPendingOp(session: WorkspaceSession, opId: string): Promise<void> {
    await resolveOp(session.id, session.userId, opId, false, "Denied by operator");
    session.pendingOps = session.pendingOps.filter(p => p.id !== opId);
  }

  /** Execute a named workflow (slash-command triggered) */
  async runWorkflow(
    session: WorkspaceSession,
    workflowName: string,
    input: string,
    userId: string
  ): Promise<{ success: boolean; artifacts: Artifact[]; summary: string }> {
    const workflow = MAVIS_WORKFLOWS.find(
      w => w.name === workflowName || w.name === workflowName.replace(/^\//, "")
    );

    if (!workflow) {
      return {
        success: false,
        artifacts: [],
        summary: `Unknown workflow: ${workflowName}. Available: ${MAVIS_WORKFLOWS.map(w => `/${w.name}`).join(", ")}`,
      };
    }

    const stepResults = new Map<string, string>(); // stepId → result
    const artifacts: Artifact[] = [];

    for (const step of workflow.steps) {
      // Check dependencies
      if (step.dependsOn?.some(dep => !stepResults.has(dep))) {
        continue; // skip if deps not resolved (simple sequential model)
      }

      // Build context from prior step results
      const priorContext = step.dependsOn
        ?.map(dep => `Step ${dep} result:\n${stepResults.get(dep)}`)
        .join("\n\n") ?? "";

      const fullInstructions = `Workflow: ${workflow.name} — Step: ${step.description}\n\n${step.instructions}\n\n${priorContext ? `Prior context:\n${priorContext}` : ""}`;

      const slot = await this.spawnAgent(
        session,
        `${step.description}: ${input}`,
        step.agentSpecialization,
        `${workflow.name}-${step.id}`
      );

      // For workflows, run synchronously by waiting for completion signal
      // (in real async env this would subscribe to bus completion events)
      const result = await dispatchAgent(
        `${fullInstructions}\n\nUser input: ${input}`,
        step.agentSpecialization,
        userId
      ).catch(err => `Error: ${(err as Error).message}`);

      stepResults.set(step.id, result);
      slot.status = "complete";

      const artifact = recordArtifact(session.id, {
        type: "report",
        title: `${workflow.name} / ${step.id}: ${step.description}`,
        content: result,
        agentId: slot.id,
        agentName: slot.name,
        sessionId: session.id,
        requiresReview: step.approvalRequired ?? false,
      });
      artifacts.push(artifact);
    }

    const summary = `Workflow ${workflow.name} completed with ${artifacts.length} artifacts.`;
    await storeMemory({
      agentId: "workspace",
      agentName: "WorkspaceCoordinator",
      agentType: "plugin",
      entityType: "experience",
      memoryType: "episodic",
      content: `Ran workflow ${workflow.name} for "${input}".\n\n${stepResults.get(workflow.steps.at(-1)?.id ?? "") ?? ""}`,
      summary,
      tags: ["workflow", workflow.name],
      wikilinks: [],
      importance: 6,
      confidence: 7,
      sourceSession: session.id,
    }, userId);

    return { success: true, artifacts, summary };
  }

  /** Get Inbox (all pending ops across session) */
  getPendingOps(session: WorkspaceSession): PendingOp[] {
    return session.pendingOps;
  }

  /** Get all artifacts produced in a session */
  getArtifacts(sessionId: string): Artifact[] {
    return getArtifacts(sessionId);
  }

  /** List available workflows */
  listWorkflows(): Array<{ name: string; description: string }> {
    return MAVIS_WORKFLOWS.map(w => ({ name: `/${w.name}`, description: w.description }));
  }

  /** List available skills with descriptions (built-in + DB runtime skills) */
  listSkills(): Array<{ name: string; description: string }> {
    const dbSkills = getAllSkills().map(s => ({ name: s.name, description: s.description }));
    const builtinNames = new Set(MAVIS_SKILLS.map(s => s.name));
    return [
      ...MAVIS_SKILLS.map(s => ({ name: s.name, description: s.description })),
      ...dbSkills.filter(s => !builtinNames.has(s.name)),
    ];
  }

  /** Get a session by ID */
  getSession(sessionId: string): WorkspaceSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Complete or fail a session and write summary */
  async closeSession(
    session: WorkspaceSession,
    userId: string,
    status: "completed" | "failed" = "completed"
  ): Promise<void> {
    const allArtifacts = getArtifacts(session.id);
    const summary = `Session "${session.sessionName}" — ${session.agents.length} agents, ` +
      `${session.completedOps.length} ops, ${allArtifacts.length} artifacts. Status: ${status}`;

    await supabase.from("mavis_workspace_sessions").update({
      status,
      summary,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", session.id).catch(() => {/* non-fatal */});

    session.status = status;
    session.summary = summary;
    this.sessions.delete(session.id);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _persistAgents(session: WorkspaceSession): Promise<void> {
    await supabase.from("mavis_workspace_sessions").update({
      agents: session.agents,
      active_agent_id: session.activeAgentId ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", session.id).catch(() => {/* non-fatal */});
  }

  private async _generateTaskPlan(
    task: string,
    specialization: AgentSpecialization,
    skills: AgentSkill[]
  ): Promise<string> {
    const skillNames = skills.map(s => s.name).join(", ") || "none";
    return [
      `# Task Plan`,
      `**Task:** ${task}`,
      `**Specialization:** ${specialization}`,
      `**Skills loaded:** ${skillNames}`,
      `**Created:** ${new Date().toLocaleString()}`,
      ``,
      `## Approach`,
      `1. Initialise agent with ${specialization} specialization`,
      skills.length ? `2. Apply skills: ${skillNames}` : `2. No specific skills loaded`,
      `3. Execute task with access to ${specialization} tool categories`,
      `4. Produce a structured output artifact`,
      `5. Store learnings in agent memory`,
    ].join("\n");
  }

  private async _runAgentTask(
    session: WorkspaceSession,
    slot: WorkspaceAgentSlot,
    task: string,
    skillContext: string
  ): Promise<void> {
    try {
      const result = await dispatchAgent(
        `${task}${skillContext}`,
        slot.specialization,
        session.userId
      );

      const artifact = recordArtifact(session.id, {
        type: "report",
        title: `Result: ${task.slice(0, 60)}`,
        content: result,
        agentId: slot.id,
        agentName: slot.name,
        sessionId: session.id,
      });

      slot.status = "complete";
      slot.lastArtifact = artifact;
      slot.currentTask = undefined;
    } catch (err) {
      slot.status = "failed";
    }

    await this._persistAgents(session);
  }
}

// ── Specialization inference ──────────────────────────────────────────────────

function inferSpecialization(task: string): AgentSpecialization {
  const t = task.toLowerCase();
  if (/research|find|search|gather|investigate|look up/.test(t)) return "researcher";
  if (/analyse|analyze|pattern|insight|data|metrics|compare/.test(t)) return "analyst";
  if (/write|draft|document|report|summarize|note/.test(t)) return "writer";
  if (/plan|decompose|breakdown|project|roadmap|schedule/.test(t)) return "planner";
  if (/review|audit|check|evaluate|assess|critique/.test(t)) return "critic";
  if (/trade|market|stock|crypto|signal|portfolio/.test(t)) return "trader";
  if (/monitor|watch|alert|observe|detect/.test(t)) return "monitor";
  return "executor";
}

// ── Tool registry integration ─────────────────────────────────────────────────
// Register workspace tools so any agent or chat can invoke them

const coordinator = new WorkspaceCoordinator();

toolRegistry.register({
  name: "list_workflows",
  description: "List all available agent workflows that can be triggered with slash commands",
  category: "analysis",
  parameters: { type: "object", properties: {} },
  async execute() {
    const workflows = coordinator.listWorkflows();
    const output = workflows.map(w => `${w.name} — ${w.description}`).join("\n");
    return { success: true, output: `Available workflows:\n${output}`, data: workflows };
  },
});

toolRegistry.register({
  name: "list_skills",
  description: "List all available agent skills that can be applied to tasks",
  category: "analysis",
  parameters: { type: "object", properties: {} },
  async execute() {
    const skills = coordinator.listSkills();
    const output = skills.map(s => `${s.name} — ${s.description}`).join("\n");
    return { success: true, output: `Available skills:\n${output}`, data: skills };
  },
});

toolRegistry.register({
  name: "run_workflow",
  description: "Run a named agent workflow (e.g. research-and-report, market-scan, knowledge-build)",
  category: "analysis",
  parameters: {
    type: "object",
    properties: {
      workflow: { type: "string", description: "Workflow name (without leading slash)" },
      input: { type: "string", description: "The topic or goal for the workflow" },
      session_id: { type: "string", description: "Workspace session ID (optional)" },
    },
    required: ["workflow", "input"],
  },
  async execute(params, userId) {
    if (!userId) return { success: false, output: "", error: "userId required" };

    let session = params.session_id ? coordinator.getSession(params.session_id as string) : undefined;
    if (!session) {
      session = await coordinator.createSession(userId, `workflow-${params.workflow}`);
    }

    const result = await coordinator.runWorkflow(session, params.workflow as string, params.input as string, userId);
    const artifactSummary = result.artifacts.map(a => `[${a.type}] ${a.title}`).join("\n");

    return {
      success: result.success,
      output: `${result.summary}\n\nArtifacts:\n${artifactSummary}`,
      data: result,
    };
  },
});

toolRegistry.register({
  name: "spawn_agent",
  description: "Spawn a specialist agent to work on a task in parallel",
  category: "analysis",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "Task description for the agent" },
      specialization: {
        type: "string",
        description: "Agent specialization (researcher/analyst/writer/planner/critic/executor/trader/monitor)",
      },
      session_id: { type: "string", description: "Workspace session ID (optional)" },
    },
    required: ["task"],
  },
  async execute(params, userId) {
    if (!userId) return { success: false, output: "", error: "userId required" };

    let session = params.session_id ? coordinator.getSession(params.session_id as string) : undefined;
    if (!session) {
      session = await coordinator.createSession(userId, `agent-${Date.now().toString(36)}`);
    }

    const slot = await coordinator.spawnAgent(
      session,
      params.task as string,
      params.specialization as AgentSpecialization | undefined
    );

    return {
      success: true,
      output: `Agent "${slot.name}" (${slot.specialization}) spawned for: ${params.task}`,
      data: { agentId: slot.id, sessionId: session.id, slot },
    };
  },
});

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  coordinator as workspaceCoordinator,
  MAVIS_SKILLS,
  MAVIS_WORKFLOWS,
  selectSkills,
  recordArtifact,
  getArtifacts,
};
