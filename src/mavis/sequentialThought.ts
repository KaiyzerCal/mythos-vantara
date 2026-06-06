/**
 * Sequential Thought Engine — Native tree-of-thought reasoning for MAVIS.
 *
 * Solves the "greedy decoding" problem: instead of generating a final answer
 * in one shot, the agent explicitly allocates thought steps, can branch,
 * revise earlier assumptions, and self-correct before any external mutation.
 *
 * Architecture mirrors @modelcontextprotocol/server-sequential-thinking but
 * runs in-process (browser + edge functions) without an external MCP server.
 * When the sequential-thinking MCP IS running locally, it defers to that.
 *
 * Three modes:
 *   chain    — linear chain-of-thought (fastest, good for single-path tasks)
 *   tree     — branches at decision points, picks best path
 *   revision — allows stepping back and revising earlier thoughts
 */

import { callLocalMesh } from "@/mavis/localMesh";
import {
  MCP_SERVERS,
  isMcpServerAlive,
  callMcpTool,
  mcpResultText,
} from "@/mavis/mcpBridge";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThoughtMode = "chain" | "tree" | "revision";

export interface Thought {
  id:           string;
  step:         number;
  content:      string;
  isRevision?:  boolean;
  revisesStep?: number;
  branch?:      string;
  confidence:   number;   // 0–1
  isFinal:      boolean;
}

export interface ThoughtChain {
  goal:         string;
  mode:         ThoughtMode;
  thoughts:     Thought[];
  conclusion:   string;
  stepsTaken:   number;
  revisionsUsed: number;
}

export interface SequentialThoughtOptions {
  mode?:          ThoughtMode;
  maxSteps?:      number;
  maxRevisions?:  number;
  model?:         string;
}

// ── Core engine ───────────────────────────────────────────────────────────────

export async function think(
  goal: string,
  context: string,
  opts: SequentialThoughtOptions = {},
): Promise<ThoughtChain> {
  const {
    mode         = "chain",
    maxSteps     = 6,
    maxRevisions = 2,
  } = opts;

  // Prefer the external MCP server when available
  if (await isMcpServerAlive(MCP_SERVERS.sequential)) {
    return _thinkViaMcp(goal, context, mode, maxSteps);
  }

  return _thinkNative(goal, context, mode, maxSteps, maxRevisions);
}

/** Shorthand: think then return just the conclusion */
export async function thinkAndConclude(
  goal: string,
  context: string,
  opts: SequentialThoughtOptions = {},
): Promise<string> {
  const chain = await think(goal, context, opts);
  return chain.conclusion;
}

// ── MCP path ──────────────────────────────────────────────────────────────────

async function _thinkViaMcp(
  goal: string,
  context: string,
  mode: ThoughtMode,
  maxSteps: number,
): Promise<ThoughtChain> {
  const thoughts: Thought[] = [];
  let step = 0;
  let isFinalThought = false;

  while (step < maxSteps && !isFinalThought) {
    step++;
    const result = await callMcpTool(MCP_SERVERS.sequential, {
      name: "sequentialthinking",
      arguments: {
        thought: step === 1 ? `Goal: ${goal}\nContext: ${context}` : thoughts.length > 0 ? thoughts[thoughts.length - 1].content : goal,
        nextThoughtNeeded: step < maxSteps,
        thoughtNumber: step,
        totalThoughts: maxSteps,
        isRevision: false,
      },
    });
    const text = mcpResultText(result);
    isFinalThought = text.toLowerCase().includes("final answer") || step >= maxSteps;
    thoughts.push({
      id: crypto.randomUUID(),
      step,
      content: text,
      confidence: isFinalThought ? 0.9 : 0.7,
      isFinal: isFinalThought,
    });
  }

  const lastThought = thoughts[thoughts.length - 1];
  return {
    goal,
    mode,
    thoughts,
    conclusion: lastThought.content,
    stepsTaken: step,
    revisionsUsed: 0,
  };
}

// ── Native in-process path ────────────────────────────────────────────────────

const THOUGHT_PROMPT = (
  goal: string,
  context: string,
  step: number,
  previousThoughts: string,
  mode: ThoughtMode,
  canRevise: boolean,
) => `You are reasoning step-by-step toward a goal. Do NOT produce a final answer yet — only the next single thought step.

GOAL: ${goal}

CONTEXT:
${context}

PREVIOUS THOUGHTS:
${previousThoughts || "(none yet)"}

INSTRUCTIONS:
- This is thought step ${step}.
- Think through ONE logical step only — do not jump to the conclusion.
- Mode: ${mode}${mode === "tree" ? " — consider alternative paths when stuck" : ""}
- ${canRevise ? "If an earlier thought was wrong, start your step with 'REVISION OF STEP N:'" : ""}
- End with: CONFIDENCE: [0.0–1.0] | FINAL: [yes/no]
- If FINAL: yes, include your complete conclusion after "CONCLUSION:"`;

async function _thinkNative(
  goal: string,
  context: string,
  mode: ThoughtMode,
  maxSteps: number,
  maxRevisions: number,
): Promise<ThoughtChain> {
  const thoughts: Thought[] = [];
  let revisionsUsed = 0;
  let step = 0;

  while (step < maxSteps) {
    step++;
    const previousThoughts = thoughts
      .map(t => `Step ${t.step}${t.isRevision ? ` (revision of ${t.revisesStep})` : ""}: ${t.content}`)
      .join("\n\n");

    const prompt = THOUGHT_PROMPT(
      goal, context, step, previousThoughts,
      mode, revisionsUsed < maxRevisions,
    );

    let raw: string;
    try {
      const meshRes = await callLocalMesh([
        { role: "system", content: "You are a sequential reasoning engine. Output exactly one thought step." },
        { role: "user",   content: prompt },
      ]);
      if (!meshRes?.content) break;
      raw = meshRes.content;
    } catch {
      break;
    }

    // Parse CONFIDENCE and FINAL markers
    const confidenceMatch = raw.match(/CONFIDENCE:\s*([\d.]+)/i);
    const finalMatch      = raw.match(/FINAL:\s*(yes|no)/i);
    const conclusionMatch = raw.match(/CONCLUSION:\s*([\s\S]+)/i);
    const revisionMatch   = raw.match(/REVISION OF STEP\s*(\d+)/i);

    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
    const isFinal    = finalMatch ? finalMatch[1].toLowerCase() === "yes" : false;
    const isRevision = !!revisionMatch;
    const revisesStep = isRevision && revisionMatch ? parseInt(revisionMatch[1]) : undefined;

    if (isRevision && revisionsUsed < maxRevisions) revisionsUsed++;

    // Strip markers from the thought content
    const content = raw
      .replace(/CONFIDENCE:\s*[\d.]+/i, "")
      .replace(/FINAL:\s*(yes|no)/i, "")
      .replace(/CONCLUSION:\s*[\s\S]+/i, "")
      .trim();

    thoughts.push({
      id: crypto.randomUUID(),
      step,
      content,
      confidence,
      isFinal,
      isRevision,
      revisesStep,
    });

    if (isFinal) {
      return {
        goal,
        mode,
        thoughts,
        conclusion: conclusionMatch?.[1]?.trim() ?? content,
        stepsTaken: step,
        revisionsUsed,
      };
    }
  }

  // Reached max steps — synthesize conclusion from all thoughts
  const synthesisPrompt = `Based on these reasoning steps, provide a concise final conclusion for the goal: "${goal}"\n\nSteps:\n${
    thoughts.map(t => `${t.step}. ${t.content}`).join("\n")
  }`;

  let conclusion = thoughts[thoughts.length - 1]?.content ?? "Reasoning incomplete.";
  try {
    const synthRes = await callLocalMesh([
      { role: "system", content: "Synthesize the reasoning steps into a final answer." },
      { role: "user",   content: synthesisPrompt },
    ]);
    if (synthRes?.content) conclusion = synthRes.content;
  } catch { /* use last thought as conclusion */ }

  return { goal, mode, thoughts, conclusion, stepsTaken: step, revisionsUsed };
}

// ── Format thought chain for injection into agent context ─────────────────────

export function formatThoughtChain(chain: ThoughtChain): string {
  const lines = [
    `═══ SEQUENTIAL REASONING (${chain.mode}, ${chain.stepsTaken} steps) ═══`,
    `Goal: ${chain.goal}`,
    "",
    ...chain.thoughts.map(t =>
      `[Step ${t.step}${t.isRevision ? ` ↩ rev.${t.revisesStep}` : ""}] ${t.content} (confidence: ${(t.confidence * 100).toFixed(0)}%)`
    ),
    "",
    `CONCLUSION: ${chain.conclusion}`,
    "═══════════════════════════════════════════════",
  ];
  return lines.join("\n");
}
