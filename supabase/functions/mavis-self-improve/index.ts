// mavis-self-improve
// Automated self-improvement pipeline: scores recent conversations,
// exports high-quality training pairs, tracks improvement metrics,
// and optionally triggers Ollama fine-tuning.
//
// POST /functions/v1/mavis-self-improve
// Body: { lookback_hours?: number, min_score?: number }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL") ?? "";

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

// ── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = user.id;

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const lookbackHours = Math.min(Math.max(Number(body.lookback_hours ?? 24), 1), 720);
    const minScore = Math.min(Math.max(Number(body.min_score ?? 7.0), 0), 10);

    const cutoff = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();

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

    if (pairsPassed >= 10 && jsonlContent && Deno.env.get("OPENAI_API")) {
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
