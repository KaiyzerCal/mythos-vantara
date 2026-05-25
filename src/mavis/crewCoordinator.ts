/**
 * Crew Coordinator — CrewAI-inspired multi-agent orchestration.
 * Breaks complex goals into specialized subtasks, dispatches to ephemeral
 * specialist agents (via dynamicAgentFactory), and synthesizes results.
 *
 * Three process types:
 *   sequential  — agents execute in order, each receiving prior output
 *   parallel    — all agents run simultaneously, results synthesized
 *   hierarchical — coordinator analyzes results and routes follow-ups
 */

import { dispatchAgent, type AgentSpecialization } from "@/mavis/dynamicAgentFactory";
import { callLocalMesh } from "@/mavis/localMesh";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

export type CrewProcessType = "sequential" | "parallel" | "hierarchical";

export interface CrewAgent {
  specialization: AgentSpecialization;
  task: string;
  dependsOn?: number; // Index of agent whose output this agent needs
}

export interface CrewConfig {
  goal: string;
  agents: CrewAgent[];
  processType: CrewProcessType;
  maxParallel?: number; // For parallel mode (default: all)
  synthesize?: boolean; // Whether to synthesize a final answer (default: true)
}

export interface CrewResult {
  goal: string;
  processType: CrewProcessType;
  agentResults: Array<{
    specialization: AgentSpecialization;
    task: string;
    output: string;
    success: boolean;
  }>;
  synthesis: string;
  totalAgents: number;
  successCount: number;
}

async function synthesizeResults(goal: string, results: CrewResult["agentResults"]): Promise<string> {
  const successResults = results.filter(r => r.success);
  if (successResults.length === 0) return "All agents failed to produce results.";
  if (successResults.length === 1) return successResults[0].output;

  const context = successResults
    .map((r, i) => `[${r.specialization.toUpperCase()} AGENT ${i + 1}]\n${r.output}`)
    .join("\n\n---\n\n");

  const synthRes = await callLocalMesh([
    { role: "system", content: "You are a synthesis engine. Combine the following specialist agent outputs into a single coherent, actionable response for the operator." },
    { role: "user", content: `GOAL: ${goal}\n\nAGENT OUTPUTS:\n${context}\n\nSynthesize these into a unified final answer:` },
  ]);

  return synthRes?.content ?? successResults.map(r => r.output).join("\n\n");
}

export async function runCrew(
  config: CrewConfig,
  userId: string,
): Promise<CrewResult> {
  const { goal, agents, processType, synthesize = true } = config;
  const agentResults: CrewResult["agentResults"] = [];

  if (processType === "parallel") {
    const promises = agents.map(async (agent) => {
      try {
        const result = await dispatchAgent(agent.task, agent.specialization, userId);
        return { specialization: agent.specialization, task: agent.task, output: result.output, success: result.success };
      } catch (e: any) {
        return { specialization: agent.specialization, task: agent.task, output: `Failed: ${e?.message}`, success: false };
      }
    });
    agentResults.push(...(await Promise.all(promises)));

  } else if (processType === "sequential") {
    let previousOutput = "";
    for (const agent of agents) {
      const taskWithContext = previousOutput
        ? `${agent.task}\n\nPrevious agent context:\n${previousOutput.slice(0, 800)}`
        : agent.task;
      try {
        const result = await dispatchAgent(taskWithContext, agent.specialization, userId);
        previousOutput = result.output;
        agentResults.push({ specialization: agent.specialization, task: agent.task, output: result.output, success: result.success });
      } catch (e: any) {
        agentResults.push({ specialization: agent.specialization, task: agent.task, output: `Failed: ${e?.message}`, success: false });
      }
    }

  } else { // hierarchical
    // Phase 1: Run all agents in parallel
    const phase1 = await Promise.allSettled(
      agents.map(async (agent) => {
        const result = await dispatchAgent(agent.task, agent.specialization, userId);
        return { specialization: agent.specialization, task: agent.task, output: result.output, success: result.success };
      })
    );
    const phase1Results = phase1.map((r, i) =>
      r.status === "fulfilled" ? r.value : { specialization: agents[i].specialization, task: agents[i].task, output: `Failed`, success: false }
    );
    agentResults.push(...phase1Results);

    // Phase 2: Coordinator decides if follow-up needed
    const successOutputs = phase1Results.filter(r => r.success);
    if (successOutputs.length > 0) {
      const coordinatorContext = successOutputs.map(r => `${r.specialization}: ${r.output.slice(0, 400)}`).join("\n");
      const coordRes = await callLocalMesh([
        { role: "system", content: "You are a coordinator reviewing specialist agent outputs. Identify any critical gaps or contradictions in ONE sentence. If complete, say COMPLETE." },
        { role: "user", content: `Goal: ${goal}\nOutputs:\n${coordinatorContext}` },
      ]);
      const coordSignal = coordRes?.content ?? "";
      if (!coordSignal.includes("COMPLETE") && coordSignal.length > 10) {
        // Run a gap-filler analyst agent
        try {
          const gapResult = await dispatchAgent(`Fill this gap: ${coordSignal}\nContext: ${goal}`, "analyst", userId);
          agentResults.push({ specialization: "analyst", task: `Gap analysis: ${coordSignal.slice(0, 60)}`, output: gapResult.output, success: gapResult.success });
        } catch { /* non-fatal */ }
      }
    }
  }

  const successCount = agentResults.filter(r => r.success).length;
  const synthesis = synthesize ? await synthesizeResults(goal, agentResults) : agentResults.map(r => r.output).join("\n\n");

  // Persist crew run to DB
  await supabase.from("mavis_agent_memories").insert({
    user_id: userId,
    agent_id: "crew-coordinator",
    agent_name: "Crew Coordinator",
    content: `Crew run: ${goal.slice(0, 100)} | ${agents.length} agents | ${successCount} succeeded`,
    memory_type: "agent_run_complete",
    entity_type: "crew",
    importance: 6,
    confidence: 0.8,
    status: "active",
  }).catch(() => {});

  return { goal, processType, agentResults, synthesis, totalAgents: agents.length, successCount };
}

/**
 * Convenience: auto-decompose a goal into agents and run as parallel crew.
 * Uses a researcher + analyst + writer pattern for general goals.
 */
export async function autoCrewDispatch(goal: string, userId: string): Promise<CrewResult> {
  const config: CrewConfig = {
    goal,
    processType: "parallel",
    agents: [
      { specialization: "researcher", task: `Research and gather information about: ${goal}` },
      { specialization: "analyst", task: `Analyze implications and patterns for: ${goal}` },
      { specialization: "planner", task: `Create an actionable execution plan for: ${goal}` },
    ],
  };
  return runCrew(config, userId);
}
