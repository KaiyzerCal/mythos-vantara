/**
 * Evaluator Pipeline — ElizaOS-inspired post-response validation hooks.
 * Evaluators run after every MAVIS response to assess quality, alignment,
 * and extract structured information (memories, facts, signals).
 *
 * Unlike filters (which block output), evaluators observe and act:
 * - Memory evaluator: extracts facts for persistent storage
 * - Goal evaluator: checks if response advances active quests
 * - Sentiment evaluator: tracks user emotional state over time
 * - Commitment evaluator: detects user commitments for task creation
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

export interface EvalContext {
  userId: string;
  userMessage: string;
  assistantResponse: string;
  mode: string;
  conversationId?: string | null;
}

export interface EvalResult {
  evaluator: string;
  passed: boolean;
  signal?: string; // Optional structured signal for downstream use
  stored?: boolean; // Whether data was persisted
}

export type EvaluatorFn = (ctx: EvalContext) => Promise<EvalResult>;

// ── Built-in evaluators ───────────────────────────────────────────────────────

/** Extract and store commitments made by the user ("I'll X", "I need to X by Y") */
const commitmentEvaluator: EvaluatorFn = async (ctx) => {
  const COMMITMENT_PATTERNS = [
    /I(?:'ll| will| need to| must| should| plan to|'m going to)\s+([^.!?]+)/gi,
    /(?:going to|planning to|have to|got to)\s+([^.!?]+)/gi,
    /by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|end of (?:day|week|month))[,\s]([^.!?]+)/gi,
  ];

  const found: string[] = [];
  for (const pattern of COMMITMENT_PATTERNS) {
    const matches = [...ctx.userMessage.matchAll(pattern)];
    for (const m of matches) {
      const commitment = m[1]?.trim();
      if (commitment && commitment.length > 5 && commitment.length < 200) {
        found.push(commitment);
      }
    }
  }

  if (found.length === 0) return { evaluator: "commitment", passed: true };

  // Queue detected commitments as pending tasks
  for (const commitment of found.slice(0, 3)) {
    await supabase.from("mavis_tasks").insert({
      user_id: ctx.userId,
      type: "inferred_commitment",
      description: `Inferred: "${commitment}"`,
      payload: { source: ctx.userMessage.slice(0, 500), commitment },
      status: "requires_confirmation",
    }).catch(() => {});
  }

  return { evaluator: "commitment", passed: true, signal: found[0], stored: true };
};

/** Track user emotional signals for longitudinal mood awareness */
const sentimentEvaluator: EvaluatorFn = async (ctx) => {
  const msg = ctx.userMessage.toLowerCase();
  const POSITIVE = ["great", "amazing", "pumped", "excited", "crushing it", "love", "perfect", "nailed", "won"];
  const NEGATIVE = ["tired", "stressed", "overwhelmed", "frustrated", "stuck", "lost", "failing", "bad", "rough"];
  const URGENT = ["urgent", "asap", "immediately", "critical", "emergency", "blocked", "can't", "stuck"];

  const posScore = POSITIVE.filter(w => msg.includes(w)).length;
  const negScore = NEGATIVE.filter(w => msg.includes(w)).length;
  const urgentFlag = URGENT.some(w => msg.includes(w));

  if (posScore === 0 && negScore === 0 && !urgentFlag) return { evaluator: "sentiment", passed: true };

  const sentiment = posScore > negScore ? "positive" : negScore > posScore ? "negative" : "neutral";

  await supabase.from("mavis_activity_log").insert({
    user_id: ctx.userId,
    event_type: "sentiment_signal",
    description: `User signal: ${sentiment}${urgentFlag ? " (URGENT)" : ""}`,
    metadata: { sentiment, posScore, negScore, urgentFlag, mode: ctx.mode },
  }).catch(() => {});

  return { evaluator: "sentiment", passed: true, signal: sentiment, stored: true };
};

/** Detect when MAVIS provides factual claims worth storing as memories */
const factExtractionEvaluator: EvaluatorFn = async (ctx) => {
  // Only run on substantial responses in knowledge-heavy modes
  const KNOWLEDGE_MODES = ["ARCH", "CODEX", "RESEARCH", "SOVEREIGN", "PRIME"];
  if (!KNOWLEDGE_MODES.includes(ctx.mode)) return { evaluator: "fact_extraction", passed: true };
  if (ctx.assistantResponse.length < 200) return { evaluator: "fact_extraction", passed: true };

  // Simple heuristic: extract sentences that look like factual statements
  const sentences = ctx.assistantResponse
    .replace(/```[\s\S]*?```/g, "") // Strip code blocks
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 40 && s.length < 300)
    .filter(s => !s.startsWith("I ") && !s.startsWith("You ") && !s.match(/^(Sure|Of course|Absolutely|Let me|Here)/i));

  if (sentences.length === 0) return { evaluator: "fact_extraction", passed: true };

  // Store top 2 as low-importance memories for review
  for (const sentence of sentences.slice(0, 2)) {
    await supabase.from("mavis_agent_memories").insert({
      user_id: ctx.userId,
      agent_id: `mavis-${ctx.mode.toLowerCase()}`,
      agent_name: `MAVIS-${ctx.mode}`,
      content: sentence,
      memory_type: "observation",
      entity_type: "knowledge",
      importance: 4,
      confidence: 0.6,
      source_session: ctx.conversationId ?? null,
      status: "active",
    }).catch(() => {});
  }

  return { evaluator: "fact_extraction", passed: true, stored: sentences.length > 0 };
};

// ── Registry ──────────────────────────────────────────────────────────────────

const _evaluators: Array<{ name: string; fn: EvaluatorFn; enabled: boolean }> = [
  { name: "commitment", fn: commitmentEvaluator, enabled: true },
  { name: "sentiment", fn: sentimentEvaluator, enabled: true },
  { name: "fact_extraction", fn: factExtractionEvaluator, enabled: true },
];

export function registerEvaluator(name: string, fn: EvaluatorFn): void {
  const idx = _evaluators.findIndex(e => e.name === name);
  if (idx >= 0) _evaluators[idx] = { name, fn, enabled: true };
  else _evaluators.push({ name, fn, enabled: true });
}

export function setEvaluatorEnabled(name: string, enabled: boolean): void {
  const e = _evaluators.find(e => e.name === name);
  if (e) e.enabled = enabled;
}

/**
 * Run all enabled evaluators against a completed exchange.
 * Fire-and-forget safe — results are stored to DB, not returned to user.
 */
export async function runEvaluators(ctx: EvalContext): Promise<EvalResult[]> {
  const enabled = _evaluators.filter(e => e.enabled);
  const results = await Promise.allSettled(enabled.map(e => e.fn(ctx)));
  return results
    .map((r, i) => r.status === "fulfilled"
      ? r.value
      : { evaluator: enabled[i].name, passed: false, signal: String((r as PromiseRejectedResult).reason) })
    .filter(Boolean) as EvalResult[];
}
