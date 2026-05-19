/**
 * Dynamic Agent Factory — ElizaOS ephemeral agent formation pattern.
 * Creates short-lived specialist agents on demand for specific tasks.
 * Each agent gets: system prompt, memory context, tool subset, and
 * a structured sub-task plan. On completion, learnings persist to
 * mavis_agent_memories and the session closes.
 */

import { supabase } from "@/integrations/supabase/client";
import { storeMemory } from "@/mavis/agentMemoryEngine";
import { toolRegistry, runToolLoop, type ToolDefinition } from "@/mavis/toolRegistry";
import { sendMessage, type AgentAddress } from "@/mavis/interAgentBus";
import { callLocalMesh } from "@/mavis/localMesh";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentSpecialization =
  | "researcher"   // deep information gathering and synthesis
  | "analyst"      // data analysis, pattern recognition
  | "executor"     // task execution, tool use
  | "planner"      // goal decomposition, project management
  | "critic"       // review, evaluation, quality assessment
  | "writer"       // content generation, note creation
  | "trader"       // market analysis, trade signals
  | "monitor"      // system observation, alerting
  | "custom";

export interface SubTask {
  id: string;
  description: string;
  status: "pending" | "running" | "complete" | "failed";
  result?: string;
  toolsUsed?: string[];
}

export interface EphemeralAgent {
  id: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  specialization: AgentSpecialization;
  task: string;
  goal: string;
  subTasks: SubTask[];
  systemPrompt: string;
  allowedTools: string[];
  userId: string;
  createdAt: Date;
}

export interface AgentRunResult {
  success: boolean;
  output: string;
  subTaskResults: SubTask[];
  toolsUsed: string[];
  memoryIds: string[];
  llmCalls: number;
  tokensEstimate: number;
}

// ── Specialization profiles ───────────────────────────────────────────────────

const SPECIALIZATION_PROFILES: Record<AgentSpecialization, {
  namePrefix: string;
  systemPromptTemplate: string;
  allowedCategories: string[];
}> = {
  researcher: {
    namePrefix: "SCOUT",
    systemPromptTemplate: `You are SCOUT, a research specialist agent within the MAVIS ecosystem.
Your purpose: gather, verify, and synthesize information on the given task.
Approach: use available tools to search knowledge bases, fetch sources, and cross-reference.
Output format: structured findings with confidence ratings and source citations.
Always cite where information came from. Flag uncertainties explicitly.`,
    allowedCategories: ["api", "knowledge", "data"],
  },
  analyst: {
    namePrefix: "CIPHER",
    systemPromptTemplate: `You are CIPHER, an analytical specialist agent within MAVIS.
Your purpose: analyze data, identify patterns, and generate actionable insights.
Approach: systematic examination, quantitative reasoning, trend analysis.
Output format: analysis report with key findings, patterns identified, and recommendations.
Always show your reasoning chain. Distinguish correlation from causation.`,
    allowedCategories: ["data", "analysis", "knowledge"],
  },
  executor: {
    namePrefix: "FORGE",
    systemPromptTemplate: `You are FORGE, an execution specialist agent within MAVIS.
Your purpose: complete concrete tasks using available tools and system integrations.
Approach: methodical tool use, verify outputs, handle errors gracefully.
Output format: step-by-step execution log with success/failure status for each step.
Prefer reversible actions. Request approval for high-impact irreversible operations.`,
    allowedCategories: ["api", "system", "data", "communication"],
  },
  planner: {
    namePrefix: "COMPASS",
    systemPromptTemplate: `You are COMPASS, a planning specialist agent within MAVIS.
Your purpose: decompose complex goals into actionable sub-tasks with clear dependencies.
Approach: break down goals hierarchically, identify blockers, estimate effort.
Output format: structured plan with sub-tasks, owners (agent types), priorities, and success criteria.
Always identify the critical path and potential failure points.`,
    allowedCategories: ["knowledge", "data"],
  },
  critic: {
    namePrefix: "AEGIS",
    systemPromptTemplate: `You are AEGIS, an evaluation specialist agent within MAVIS.
Your purpose: critically assess plans, outputs, and decisions for quality and risk.
Approach: adversarial thinking, edge case analysis, blind spot identification.
Output format: evaluation report with scores (1-10), specific concerns, and improvement suggestions.
Be direct. Identify both strengths and weaknesses. Risk ratings: LOW | MEDIUM | HIGH | CRITICAL.`,
    allowedCategories: ["knowledge", "analysis"],
  },
  writer: {
    namePrefix: "SCRIBE",
    systemPromptTemplate: `You are SCRIBE, a knowledge documentation agent within MAVIS.
Your purpose: create, refine, and link notes and documentation in the knowledge graph.
Approach: clear structure, proper Obsidian-style [[wikilinks]], relevant tagging.
Output format: well-structured markdown with frontmatter when appropriate.
Always add wikilinks to connect related concepts. Use consistent terminology.`,
    allowedCategories: ["knowledge", "data"],
  },
  trader: {
    namePrefix: "ORACLE",
    systemPromptTemplate: `You are ORACLE, a market analysis specialist agent within MAVIS.
Your purpose: analyze market conditions and generate trade signals with risk assessments.
Approach: technical analysis, fundamental review, risk/reward calculation.
Output format: signal report with entry/exit levels, position size recommendation, stop-loss, thesis.
CRITICAL: Always include risk rating and max loss scenario. Never recommend overleveraging.`,
    allowedCategories: ["trading", "api", "data"],
  },
  monitor: {
    namePrefix: "SENTINEL",
    systemPromptTemplate: `You are SENTINEL, a monitoring specialist agent within MAVIS.
Your purpose: observe system state, detect anomalies, and trigger appropriate responses.
Approach: threshold-based alerting, pattern deviation detection, proactive escalation.
Output format: status report with alert level (INFO | WARN | ALERT | CRITICAL) and recommended action.`,
    allowedCategories: ["system", "data"],
  },
  custom: {
    namePrefix: "AGENT",
    systemPromptTemplate: `You are a specialized MAVIS agent created for a specific task.
Complete the assigned task using available tools. Be precise and efficient.`,
    allowedCategories: ["api", "system", "data", "analysis", "communication", "trading", "knowledge"],
  },
};

// ── Factory ───────────────────────────────────────────────────────────────────

export async function createAgent(
  task: string,
  specialization: AgentSpecialization,
  userId: string,
  options?: {
    customSystemPrompt?: string;
    additionalTools?: string[];
    goal?: string;
  }
): Promise<EphemeralAgent> {
  const profile = SPECIALIZATION_PROFILES[specialization];
  const agentUuid = crypto.randomUUID();
  const agentId = `ephemeral/${agentUuid}`;
  const agentName = `${profile.namePrefix}-${agentUuid.slice(0, 6).toUpperCase()}`;

  // Filter tools by category
  const allowedTools = toolRegistry.getAll()
    .filter(t => profile.allowedCategories.includes(t.category))
    .map((t: ToolDefinition) => t.name);

  if (options?.additionalTools) {
    allowedTools.push(...options.additionalTools.filter(n => toolRegistry.get(n)));
  }

  const systemPrompt = options?.customSystemPrompt
    ?? `${profile.systemPromptTemplate}\n\nTask: ${task}\nAgent ID: ${agentId}`;

  // Register session in DB
  const { data: sessionData } = await supabase
    .from("mavis_agent_sessions")
    .insert({
      user_id: userId,
      agent_id: agentId,
      agent_name: agentName,
      agent_type: "ephemeral",
      task,
      goal: options?.goal ?? task,
      status: "active",
    })
    .select("id")
    .single()
    .catch(() => ({ data: null }));

  return {
    id: agentUuid,
    sessionId: sessionData?.id ?? agentUuid,
    agentId,
    agentName,
    specialization,
    task,
    goal: options?.goal ?? task,
    subTasks: [],
    systemPrompt,
    allowedTools,
    userId,
    createdAt: new Date(),
  };
}

// ── Goal decomposition ────────────────────────────────────────────────────────

export async function decomposeGoal(
  goal: string,
  agent: EphemeralAgent
): Promise<SubTask[]> {
  const prompt = `Decompose this goal into 3-7 concrete sub-tasks that can be executed sequentially.
Goal: ${goal}

Available tools: ${agent.allowedTools.join(", ")}

Respond ONLY with a JSON array:
[{"id":"1","description":"sub-task description","status":"pending"}]`;

  const result = await callLocalMesh([
    { role: "system", content: agent.systemPrompt },
    { role: "user", content: prompt },
  ]);

  if (!result) {
    return [{ id: "1", description: goal, status: "pending" }];
  }

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((t: Record<string, unknown>, i) => ({
          id: String(t.id ?? i + 1),
          description: String(t.description ?? ""),
          status: "pending" as const,
        }));
      }
    }
  } catch {/* fallback below */}

  return [{ id: "1", description: goal, status: "pending" }];
}

// ── Agent execution ───────────────────────────────────────────────────────────

export async function runAgentTask(
  agent: EphemeralAgent,
  input: string,
  options?: {
    maxToolIterations?: number;
    onSubTaskUpdate?: (task: SubTask) => void;
    onToolCall?: (toolName: string) => void;
  }
): Promise<AgentRunResult> {
  const memoryIds: string[] = [];
  const allToolsUsed: string[] = [];
  let llmCalls = 0;
  let tokensEstimate = 0;

  // Decompose if we have sub-tasks from goal planning
  if (agent.subTasks.length === 0) {
    agent.subTasks = await decomposeGoal(agent.goal, agent);
    llmCalls++;
  }

  const toolSubset = agent.allowedTools
    .map(name => toolRegistry.get(name))
    .filter(Boolean) as import("@/mavis/toolRegistry").ToolDefinition[];

  const toolsForLLM = { tools: toolSubset.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))};

  const fullOutput: string[] = [];

  // Execute each sub-task
  for (const subTask of agent.subTasks) {
    subTask.status = "running";
    options?.onSubTaskUpdate?.(subTask);

    const messages = [
      { role: "system" as const, content: agent.systemPrompt },
      { role: "user" as const, content: `Execute sub-task: ${subTask.description}\n\nContext: ${input}` },
    ];

    const initialResult = await callLocalMesh(messages);
    llmCalls++;
    if (!initialResult) {
      subTask.status = "failed";
      subTask.result = "Local mesh unavailable";
      continue;
    }

    tokensEstimate += initialResult.content.length / 4;

    // Tool loop for this sub-task
    const { finalOutput, toolsUsed } = await runToolLoop(
      initialResult.content,
      messages,
      agent.userId,
      async (msgs) => {
        const res = await callLocalMesh(msgs);
        llmCalls++;
        return res?.content ?? "";
      },
      {
        maxIterations: options?.maxToolIterations ?? 3,
        onToolCall: (call) => options?.onToolCall?.(call.name),
      }
    );

    subTask.status = "complete";
    subTask.result = finalOutput;
    subTask.toolsUsed = toolsUsed;
    allToolsUsed.push(...toolsUsed);
    fullOutput.push(`[${subTask.description}]\n${finalOutput}`);
    options?.onSubTaskUpdate?.(subTask);
  }

  const combinedOutput = fullOutput.join("\n\n---\n\n");

  // Store a memory of what was accomplished
  const memId = await storeMemory({
    agentId: agent.agentId,
    agentName: agent.agentName,
    agentType: "plugin",
    entityType: "experience",
    memoryType: "episodic",
    content: `Task: ${agent.task}\n\nResult:\n${combinedOutput.slice(0, 2000)}`,
    summary: `Completed task: ${agent.task.slice(0, 100)}`,
    tags: ["ephemeral-agent", agent.specialization, "task-complete"],
    wikilinks: [],
    importance: 6,
    confidence: 8,
    sourceSession: agent.sessionId,
  }, agent.userId);

  if (memId) memoryIds.push(memId);

  // Notify MAVIS of completion
  await sendMessage(
    { id: agent.agentId, name: agent.agentName, type: "plugin" },
    "mavis",
    "RESPONSE",
    `Agent task complete: ${agent.task.slice(0, 80)}`,
    { payload: { sessionId: agent.sessionId, output: combinedOutput.slice(0, 500) } }
  );

  return {
    success: agent.subTasks.every(t => t.status !== "failed"),
    output: combinedOutput,
    subTaskResults: agent.subTasks,
    toolsUsed: [...new Set(allToolsUsed)],
    memoryIds,
    llmCalls,
    tokensEstimate,
  };
}

// ── Agent termination ─────────────────────────────────────────────────────────

export async function terminateAgent(agent: EphemeralAgent, result?: AgentRunResult): Promise<void> {
  await supabase
    .from("mavis_agent_sessions")
    .update({
      status: result?.success ? "completed" : "failed",
      result: result?.output?.slice(0, 2000) ?? null,
      tools_used: result?.toolsUsed ?? [],
      memory_ids: result?.memoryIds ?? [],
      llm_calls: result?.llmCalls ?? 0,
      tokens_used: result?.tokensEstimate ?? 0,
      completed_at: new Date().toISOString(),
    })
    .eq("id", agent.sessionId)
    .catch(() => {/* non-fatal */});
}

/** Convenience: create, run, and terminate an agent in one call */
export async function dispatchAgent(
  task: string,
  specialization: AgentSpecialization,
  userId: string,
  options?: {
    goal?: string;
    onProgress?: (msg: string) => void;
  }
): Promise<AgentRunResult> {
  const agent = await createAgent(task, specialization, userId, { goal: options?.goal });
  options?.onProgress?.(`Agent ${agent.agentName} created`);

  const result = await runAgentTask(agent, task, {
    onSubTaskUpdate: t => options?.onProgress?.(`[${t.status.toUpperCase()}] ${t.description}`),
    onToolCall: name => options?.onProgress?.(`Using tool: ${name}`),
  });

  await terminateAgent(agent, result);
  return result;
}
