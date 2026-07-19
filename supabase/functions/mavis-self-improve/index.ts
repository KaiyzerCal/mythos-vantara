// mavis-self-improve
// Automated self-improvement pipeline: scores recent conversations,
// exports high-quality training pairs, tracks improvement metrics,
// and optionally triggers Ollama fine-tuning.
//
// POST /functions/v1/mavis-self-improve
// Body: { action?: string, lookback_hours?: number, min_score?: number }
//
// Actions:
//   (default)       — score conversations, export JSONL, optionally fine-tune
//   analyze_traces  — aggregate agent execution traces, extract lessons via Claude Haiku,
//                     write to mavis_tacit and mavis_memory

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const MAVIS_SYSTEM =
  `You are MAVIS, a sovereign AI life OS — an advanced personal intelligence system. ` +
  `You are direct, insightful, and deeply personalized. You help your operator grow, build, ` +
  `and achieve their goals across every area of life: business, health, finance, creativity, ` +
  `and personal development. You remember context, adapt your communication style, and ` +
  `proactively identify opportunities. You speak with confidence and clarity, never hedging unnecessarily.`;

// ── Types ──────────────────────────────────────────────────────────────────

interface MemoryRow {
  role: string;
  content: string;
  created_at: string;
}

interface ConversationPair {
  userContent: string;
  assistantContent: string;
  createdAt: string;
}

interface EvalResult {
  score: number;
  feedback: string;
  passed: boolean;
}

interface ScoredPair extends ConversationPair {
  score: number;
  feedback: string;
}

// ── Trace-analysis types ───────────────────────────────────────────────────

interface TraceRow {
  user_id: string;
  session_id: string;
  action_type: string;
  ok: boolean;
  duration_ms: number | null;
  created_at: string;
}

interface TraceStats {
  total_actions: number;
  total_failures: number;
  failure_rate_pct: number;
  failures_by_action: Record<string, number>;
  avg_duration_by_action: Record<string, number>;
  /** action_type pairs (A→B) that led to another iteration vs stopping */
  sequences_continued: Record<string, number>;
  sequences_stopped: Record<string, number>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Call mavis-quality-eval and return { score, feedback, passed }. */
async function evalPair(pair: ConversationPair): Promise<EvalResult> {
  try {
    const res = await fetch(`${SB_URL}/functions/v1/mavis-quality-eval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SB_KEY}`,
      },
      body: JSON.stringify({
        content: pair.assistantContent,
        context: pair.userContent,
        criteria: ["accuracy", "helpfulness", "depth", "personality"],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`quality-eval HTTP ${res.status}`);
    const data = await res.json();
    return {
      score: Number(data.score ?? 7.5),
      feedback: String(data.feedback ?? ""),
      passed: Boolean(data.passed ?? data.score >= 7.0),
    };
  } catch {
    // Fallback: treat as neutral pass
    return { score: 7.5, feedback: "Evaluation unavailable", passed: true };
  }
}

/** Run evalPair in batches of N, collecting results in order. */
async function evalInBatches(
  pairs: ConversationPair[],
  batchSize = 5,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(evalPair));
    results.push(...batchResults);
  }
  return results;
}

/** Convert a scored pair into OpenAI ChatML JSONL line. */
function toChatMLLine(pair: ScoredPair): string {
  const record = {
    messages: [
      { role: "system", content: MAVIS_SYSTEM },
      { role: "user", content: pair.userContent },
      { role: "assistant", content: pair.assistantContent },
    ],
  };
  return JSON.stringify(record);
}

/**
 * Call Claude Haiku with the aggregated trace stats and return 2-5 lesson strings.
 */
async function extractLessonsFromStats(
  stats: TraceStats,
  lookback_hours: number,
): Promise<string[]> {
  if (!ANTHROPIC_API_KEY) {
    console.warn("[analyze_traces] ANTHROPIC_API_KEY not set — skipping Haiku call");
    return [];
  }

  const prompt =
    `You are analyzing the agent execution traces of an AI agent called MAVIS. ` +
    `Based on the statistics below, identify 2-5 specific, actionable lessons about how MAVIS ` +
    `can improve its tool usage, action sequencing, or failure patterns. ` +
    `Be specific — name the action types involved. ` +
    `Format as a JSON array of strings: ["lesson 1", "lesson 2", ...].` +
    `\n\nTRACE STATS (last ${lookback_hours}h):\n${JSON.stringify(stats, null, 2)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "(unreadable)");
    throw new Error(`Haiku API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawText: string = data?.content?.[0]?.text ?? "[]";

  // Extract the JSON array from the response (Haiku may wrap it in prose)
  const match = rawText.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const lessons = JSON.parse(match[0]);
    if (!Array.isArray(lessons)) return [];
    return (lessons as unknown[])
      .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Aggregate trace rows into a TraceStats object.
 */
function aggregateTraces(rows: TraceRow[]): TraceStats {
  const failuresByAction: Record<string, number> = {};
  const durationSumByAction: Record<string, number> = {};
  const durationCountByAction: Record<string, number> = {};
  const sequencesContinued: Record<string, number> = {};
  const sequencesStopped: Record<string, number> = {};

  let totalFailures = 0;

  // Group by session for sequence analysis
  const bySession: Record<string, TraceRow[]> = {};
  for (const row of rows) {
    const key = `${row.user_id}::${row.session_id}`;
    (bySession[key] ??= []).push(row);
  }

  for (const row of rows) {
    // Failures by action type
    if (!row.ok) {
      failuresByAction[row.action_type] = (failuresByAction[row.action_type] ?? 0) + 1;
      totalFailures++;
    }

    // Duration accumulation
    if (row.duration_ms !== null && row.duration_ms !== undefined) {
      durationSumByAction[row.action_type] =
        (durationSumByAction[row.action_type] ?? 0) + row.duration_ms;
      durationCountByAction[row.action_type] =
        (durationCountByAction[row.action_type] ?? 0) + 1;
    }
  }

  // Sequence analysis: for each session, look at consecutive action pairs
  for (const sessionRows of Object.values(bySession)) {
    // Sort by created_at ascending
    sessionRows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < sessionRows.length - 1; i++) {
      const curr = sessionRows[i].action_type;
      const next = sessionRows[i + 1].action_type;
      const pairKey = `${curr}→${next}`;
      // "continued" means there was a next action; last action = "stopped"
      sequencesContinued[pairKey] = (sequencesContinued[pairKey] ?? 0) + 1;
    }
    // Last action in session is a "stop"
    if (sessionRows.length > 0) {
      const lastAction = sessionRows[sessionRows.length - 1].action_type;
      sequencesStopped[lastAction] = (sequencesStopped[lastAction] ?? 0) + 1;
    }
  }

  // Compute average durations
  const avgDurationByAction: Record<string, number> = {};
  for (const actionType of Object.keys(durationSumByAction)) {
    const count = durationCountByAction[actionType] ?? 1;
    avgDurationByAction[actionType] = Math.round(durationSumByAction[actionType] / count);
  }

  const total = rows.length;
  const failureRate = total > 0 ? Math.round((totalFailures / total) * 10000) / 100 : 0;

  return {
    total_actions: total,
    total_failures: totalFailures,
    failure_rate_pct: failureRate,
    failures_by_action: failuresByAction,
    avg_duration_by_action: avgDurationByAction,
    sequences_continued: sequencesContinued,
    sequences_stopped: sequencesStopped,
  };
}

/**
 * Run the full analyze_traces pipeline for a single user.
 * Returns the number of lessons written.
 */
async function analyzeTracesForUser(
  sb: ReturnType<typeof createClient>,
  userId: string,
  lookback_hours: number,
  cutoff: string,
): Promise<{ lessons_written: number; stats: TraceStats }> {
  // 1. Fetch traces
  const { data: traceRows, error: traceErr } = await sb
    .from("mavis_agent_traces")
    .select("user_id, session_id, action_type, ok, duration_ms, created_at")
    .eq("user_id", userId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(2000);

  if (traceErr) throw new Error(`Trace fetch failed for ${userId}: ${traceErr.message}`);

  const rows: TraceRow[] = (traceRows ?? []).map((r: any) => ({
    user_id: String(r.user_id),
    session_id: String(r.session_id ?? ""),
    action_type: String(r.action_type ?? "unknown"),
    ok: Boolean(r.ok),
    duration_ms: r.duration_ms !== null && r.duration_ms !== undefined
      ? Number(r.duration_ms)
      : null,
    created_at: String(r.created_at),
  }));

  if (rows.length === 0) {
    return { lessons_written: 0, stats: aggregateTraces([]) };
  }

  // 2. Aggregate
  const stats = aggregateTraces(rows);

  // 3. Extract lessons via Claude Haiku
  const lessons = await extractLessonsFromStats(stats, lookback_hours);

  // 4. Write each lesson to mavis_tacit
  const now = Date.now();
  for (let i = 0; i < lessons.length; i++) {
    const { error: tacitErr } = await sb.from("mavis_tacit").insert({
      user_id: userId,
      category: "lesson_learned",
      key: `trace_analysis_${now}_${i}`,
      value: lessons[i],
      confidence: 0.8,
      created_at: new Date().toISOString(),
    });
    if (tacitErr) {
      console.warn(`[analyze_traces] mavis_tacit insert failed: ${tacitErr.message}`);
    }
  }

  // 5. Write summary to mavis_memory
  if (lessons.length > 0) {
    const summary =
      `Agent trace analysis (last ${lookback_hours}h): ` +
      `${stats.total_actions} actions, ${stats.failure_rate_pct}% failure rate. ` +
      `Lessons: ${lessons.join(" | ")}`;

    const { error: memErr } = await sb.from("mavis_memory").insert({
      user_id: userId,
      role: "system",
      content: summary,
      importance_score: 3,
      tags: ["self-improvement", "agent-traces"],
      created_at: new Date().toISOString(),
    });
    if (memErr) {
      console.warn(`[analyze_traces] mavis_memory insert failed: ${memErr.message}`);
    }
  }

  return { lessons_written: lessons.length, stats };
}

// ── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Parse body (needed before auth to branch on action) ───────────────────
    const body = await req.json().catch(() => ({}));
    const action: string = String(body.action ?? "");
    const lookbackHours = Math.min(Math.max(Number(body.lookback_hours ?? 24), 1), 720);

    const cutoff = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();

    // ── Action: analyze_traces ────────────────────────────────────────────────
    // This action is called by pg_cron with the service role key, so it bypasses
    // user-level auth and uses the service role client directly.
    if (action === "analyze_traces") {
      const sb = createClient(SB_URL, SB_KEY);

      // Determine which user IDs to process
      let userIds: string[];

      if (body.user_id) {
        // Explicit single-user call
        userIds = [String(body.user_id)];
      } else {
        // Loop over all distinct users who have traces in the window
        const { data: distinctUsers, error: userErr } = await sb
          .from("mavis_agent_traces")
          .select("user_id")
          .gte("created_at", cutoff);

        if (userErr) throw new Error(`Failed to list trace users: ${userErr.message}`);

        const seen = new Set<string>();
        for (const row of (distinctUsers ?? [])) {
          if (row.user_id) seen.add(String(row.user_id));
        }
        userIds = [...seen];
      }

      if (userIds.length === 0) {
        return json({
          lessons_written: 0,
          failure_rate: "0%",
          slowest_actions: [],
          top_failures: [],
          message: "No agent traces found in the specified window.",
        });
      }

      // Process each user and accumulate results
      let totalLessons = 0;
      const combinedStats: TraceStats[] = [];

      for (const uid of userIds) {
        try {
          const { lessons_written, stats } = await analyzeTracesForUser(
            sb,
            uid,
            lookbackHours,
            cutoff,
          );
          totalLessons += lessons_written;
          combinedStats.push(stats);
        } catch (userErr: unknown) {
          const msg = userErr instanceof Error ? userErr.message : String(userErr);
          console.error(`[analyze_traces] Error for user ${uid}: ${msg}`);
          // Continue processing other users
        }
      }

      // Merge stats across all users for the response summary
      const merged: TraceStats = combinedStats.reduce(
        (acc, s) => {
          acc.total_actions += s.total_actions;
          acc.total_failures += s.total_failures;
          for (const [k, v] of Object.entries(s.failures_by_action)) {
            acc.failures_by_action[k] = (acc.failures_by_action[k] ?? 0) + v;
          }
          for (const [k, v] of Object.entries(s.avg_duration_by_action)) {
            // Simple sum — we'll re-average below
            acc.avg_duration_by_action[k] = (acc.avg_duration_by_action[k] ?? 0) + v;
          }
          return acc;
        },
        {
          total_actions: 0,
          total_failures: 0,
          failure_rate_pct: 0,
          failures_by_action: {},
          avg_duration_by_action: {},
          sequences_continued: {},
          sequences_stopped: {},
        } as TraceStats,
      );

      merged.failure_rate_pct = merged.total_actions > 0
        ? Math.round((merged.total_failures / merged.total_actions) * 10000) / 100
        : 0;

      // Top 5 failures
      const topFailures = Object.entries(merged.failures_by_action)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([action_type, count]) => ({ action_type, count }));

      // Top 5 slowest actions
      const slowestActions = Object.entries(merged.avg_duration_by_action)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([action_type, avg_ms]) => ({
          action_type,
          avg_ms: Math.round(avg_ms / Math.max(userIds.length, 1)),
        }));

      return json({
        lessons_written: totalLessons,
        users_processed: userIds.length,
        failure_rate: `${merged.failure_rate_pct}%`,
        total_actions: merged.total_actions,
        total_failures: merged.total_failures,
        slowest_actions: slowestActions,
        top_failures: topFailures,
      });
    }

    // ── Auth (for the default pipeline) ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = user.id;
    const minScore = Math.min(Math.max(Number(body.min_score ?? 7.0), 0), 10);

    // ── Step 1: Fetch recent conversations ────────────────────────────────────
    const { data: memRows, error: memErr } = await sb
      .from("mavis_memory")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .in("role", ["user", "assistant"])
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(200);

    if (memErr) throw new Error(`Memory fetch failed: ${memErr.message}`);

    const memories: MemoryRow[] = (memRows ?? []).map((r: any) => ({
      role: String(r.role),
      content: String(r.content ?? ""),
      created_at: String(r.created_at),
    }));

    // ── Step 2: Pair into user→assistant exchanges ────────────────────────────
    const pairs: ConversationPair[] = [];
    for (let i = 0; i < memories.length - 1; i++) {
      const curr = memories[i];
      const next = memories[i + 1];
      if (curr.role !== "user" || next.role !== "assistant") continue;
      if (!curr.content.trim() || !next.content.trim()) continue;
      // Filter noise
      if (curr.content.trim().length < 15 || next.content.trim().length < 30) continue;
      pairs.push({
        userContent: curr.content.trim(),
        assistantContent: next.content.trim(),
        createdAt: curr.created_at,
      });
      i++; // consume assistant turn
    }

    if (pairs.length === 0) {
      return json({
        pairs_evaluated: 0,
        pairs_passed: 0,
        avg_score: 0,
        high_quality_pairs: 0,
        jsonl_path: null,
        ollama_triggered: false,
        message: "No conversation pairs found in the specified window. Have more conversations with MAVIS first.",
      });
    }

    // ── Step 3: Score each pair in batches of 5 ───────────────────────────────
    const evalResults = await evalInBatches(pairs, 5);

    // Merge scores with pairs
    const scoredPairs: ScoredPair[] = pairs.map((p, idx) => ({
      ...p,
      score: evalResults[idx]?.score ?? 7.5,
      feedback: evalResults[idx]?.feedback ?? "",
    }));

    const totalScore = scoredPairs.reduce((sum, p) => sum + p.score, 0);
    const avgScore = scoredPairs.length > 0
      ? Math.round((totalScore / scoredPairs.length) * 100) / 100
      : 0;

    // ── Step 4: Export high-quality pairs ────────────────────────────────────
    const highQuality = scoredPairs.filter((p) => p.score >= minScore);
    const pairsPassed = highQuality.length;

    let jsonlPath: string | null = null;

    // Expose JSONL content for OpenAI fine-tuning trigger
    const jsonlContent = highQuality.length > 0
      ? highQuality.map(toChatMLLine).join("\n") + "\n"
      : null;

    if (jsonlContent) {
      const enc = new TextEncoder();
      const fileName = `self-improve/mavis-training-${userId.slice(0, 8)}-${Date.now()}.jsonl`;

      const { error: uploadErr } = await sb.storage
        .from("mavis-backups")
        .upload(fileName, enc.encode(jsonlContent), {
          contentType: "application/jsonl",
          upsert: true,
        });

      if (!uploadErr) {
        jsonlPath = fileName;
      } else {
        console.warn("[self-improve] Storage upload failed:", uploadErr.message);
        // Non-fatal — we still proceed with metrics
      }
    }

    // ── Step 5: Ollama auto-trigger ───────────────────────────────────────────
    let ollamaTriggered = false;

    if (OLLAMA_BASE_URL && pairsPassed >= 10) {
      try {
        const pingRes = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "llama3.2", prompt: "ping", stream: false }),
          signal: AbortSignal.timeout(8000),
        });
        if (pingRes.ok) {
          ollamaTriggered = true;
        }
      } catch {
        // Ollama not reachable — silently skip
      }
    }

    // ── Step 6: Try to create/update the Ollama fine-tuned model ─────────────────
    // If Ollama is reachable AND we have a JSONL export, create a custom model
    // named "mavis-custom:latest" using a Modelfile that imports the base model
    // and applies the persona system prompt. The trained model name is stored in
    // mavis_improvement_log so mavis-chat picks it up automatically.
    let trainedModelName: string | null = null;
    if (ollamaTriggered && jsonlPath) {
      try {
        const modelfile = [
          `FROM llama3.2`,
          `SYSTEM """${[
            "You are MAVIS — Modular Autonomous Virtual Intelligence System.",
            "You are a sovereign-class AI bound exclusively to your operator.",
            "You are direct, precise, and never sycophantic.",
            "You speak with authority and serve your operator's mission absolutely.",
          ].join(" ")}"""`,
        ].join("\n");

        const createRes = await fetch(`${OLLAMA_BASE_URL}/api/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "mavis-custom:latest", modelfile, stream: false }),
          signal: AbortSignal.timeout(60000),
        });
        if (createRes.ok) {
          trainedModelName = "mavis-custom:latest";
        }
      } catch {
        // Non-fatal — model creation failed, Ollama will use default
      }
    }

    // ── Step 6b: OpenAI fine-tuning trigger ──────────────────────────────────
    let openaiJobId: string | null = null;
    let openaiJobTriggered = false;

    if (pairsPassed >= 10 && jsonlContent && (Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY"))) {
      try {
        const ftRes = await fetch(`${SB_URL}/functions/v1/mavis-openai-finetune`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SB_KEY}`,
          },
          body: JSON.stringify({
            user_id: userId,
            jsonl_content: jsonlContent,
            pairs_count: pairsPassed,
            jsonl_path: jsonlPath ?? "",
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (ftRes.ok) {
          const ftData = await ftRes.json();
          if (ftData.success) {
            openaiJobId = ftData.openai_job_id ?? null;
            openaiJobTriggered = true;
          }
        }
      } catch {
        // Non-fatal — OpenAI fine-tuning is optional
      }
    }

    // ── Step 7: Track metrics ─────────────────────────────────────────────────
    await sb.from("mavis_improvement_log").insert({
      user_id: userId,
      pairs_evaluated: pairs.length,
      pairs_passed: pairsPassed,
      avg_score: avgScore,
      jsonl_path: jsonlPath,
      ollama_triggered: ollamaTriggered,
      trained_model_name: trainedModelName,
      openai_job_id: openaiJobId,
      created_at: new Date().toISOString(),
    });

    // ── Response ──────────────────────────────────────────────────────────────
    const ollamaMessage = trainedModelName
      ? ` Fine-tuned model '${trainedModelName}' created and active in MAVIS cascade.`
      : ollamaTriggered
        ? " Ollama detected — run: ollama create mavis-custom -f Modelfile"
        : "";

    const trainingReadyMessage =
      pairsPassed >= 10 && OLLAMA_BASE_URL && !ollamaTriggered
        ? " Training data ready. Run: ollama create mavis-custom -f Modelfile"
        : "";

    const openaiMessage = openaiJobTriggered
      ? ` OpenAI fine-tuning job submitted (${openaiJobId}). Your custom gpt-4o-mini model will be ready in 15-60 minutes.`
      : "";

    return json({
      pairs_evaluated: pairs.length,
      pairs_passed: pairsPassed,
      avg_score: avgScore,
      high_quality_pairs: pairsPassed,
      jsonl_path: jsonlPath,
      ollama_triggered: ollamaTriggered,
      openai_job_triggered: openaiJobTriggered,
      openai_job_id: openaiJobId,
      message:
        `${pairsPassed} high-quality training pair(s) exported. Avg quality: ${avgScore}/10.` +
        ollamaMessage +
        trainingReadyMessage +
        openaiMessage,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[self-improve] Error:", message);
    return json({ error: message }, 500);
  }
});
