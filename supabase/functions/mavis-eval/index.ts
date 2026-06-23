// mavis-eval — Weekly agent quality evaluation loop.
//
// Measures MAVIS's response quality across 5 rubrics, compares to the prior
// week, persists scores, and fires an alert if any rubric drops > 1.5 points.
//
// Actions:
//   evaluate_conversations — sample recent convos, score with Claude Haiku, store results
//   get_eval_history       — return last N weeks of scores grouped by week
//
// Cron: every Saturday 2 AM UTC (via pg_cron — see migration 20260618000010)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RUBRICS = ["relevance", "accuracy", "action_correctness", "calibration", "tone"] as const;
type Rubric = typeof RUBRICS[number];
type RubricScores = Record<Rubric, number>;

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Resolve userId from Bearer token ─────────────────────────────────────────

async function resolveUserId(req: Request, sb: ReturnType<typeof createClient>): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (token === SB_SRK) return null; // service role — userId must come from body
  const { data: { user } } = await sb.auth.getUser(token);
  return user?.id ?? null;
}

// ── Pair user/assistant turns by proximity (within 60 seconds) ───────────────

interface MemoryRow {
  content: string;
  role: string;
  timestamp: number | null;
  created_at: string;
}

interface ConvoPair {
  user: string;
  assistant: string;
}

function pairConversations(rows: MemoryRow[]): ConvoPair[] {
  const pairs: ConvoPair[] = [];
  const used = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue;
    if (rows[i].role !== "user") continue;

    const userTs = rows[i].timestamp ?? new Date(rows[i].created_at).getTime();

    // Look for assistant turn within 60 s after this user turn
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(j)) continue;
      if (rows[j].role !== "assistant") continue;

      const aTs = rows[j].timestamp ?? new Date(rows[j].created_at).getTime();
      const diffMs = Math.abs(aTs - userTs);

      if (diffMs <= 60_000) {
        pairs.push({ user: rows[i].content, assistant: rows[j].content });
        used.add(i);
        used.add(j);
        break;
      }
    }
  }

  return pairs;
}

// ── Score conversation sample with Claude Haiku ───────────────────────────────

async function scoreWithClaude(pairs: ConvoPair[]): Promise<RubricScores & { notes: string }> {
  const sampleText = pairs
    .slice(0, 15)
    .map((p, i) =>
      `--- Pair ${i + 1} ---\nUser: ${p.user.slice(0, 300)}\nMAVIS: ${p.assistant.slice(0, 400)}`
    )
    .join("\n\n");

  const prompt =
    `You are evaluating an AI agent's conversation quality. Score each rubric 1-10 based on the sample below.\n\n` +
    `Rubrics:\n` +
    `- relevance: Did MAVIS respond to what was actually asked?\n` +
    `- accuracy: Were factual claims and retrieved data correct?\n` +
    `- action_correctness: Were any tool/action uses appropriate and well-targeted?\n` +
    `- calibration: Did MAVIS express appropriate confidence vs. uncertainty?\n` +
    `- tone: Did the response match the operator's communication style and needs?\n\n` +
    `Conversation sample:\n${sampleText}\n\n` +
    `Reply ONLY with JSON: {"relevance": N, "accuracy": N, "action_correctness": N, "calibration": N, "tone": N, "notes": "brief observations"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);

  const data = await res.json() as any;
  const rawText = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text as string)
    .join("");

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Claude response");

  const parsed = JSON.parse(jsonMatch[0]);

  // Clamp scores to [1,10]
  const scores = {} as RubricScores & { notes: string };
  for (const rubric of RUBRICS) {
    scores[rubric] = Math.min(10, Math.max(1, Number(parsed[rubric] ?? 7)));
  }
  scores.notes = typeof parsed.notes === "string" ? parsed.notes.slice(0, 500) : "";

  return scores;
}

// ── Action: evaluate_conversations ────────────────────────────────────────────

async function evaluateConversations(
  sb: ReturnType<typeof createClient>,
  userId: string,
  hoursBack: number,
): Promise<unknown> {
  const cutoffMs = Date.now() - hoursBack * 3_600_000;
  const weekStart = new Date();
  weekStart.setUTCHours(0, 0, 0, 0);
  // Roll back to most recent Saturday
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() - 1);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  // 1. Fetch up to 30 conversation memory rows
  const { data: rows, error: fetchErr } = await sb
    .from("mavis_memory")
    .select("content, role, timestamp, created_at")
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .gte("importance_score", 2)
    .gte("timestamp", cutoffMs)
    .order("timestamp", { ascending: false })
    .limit(30);

  if (fetchErr) throw new Error(`Memory fetch error: ${fetchErr.message}`);

  const memRows = (rows ?? []) as MemoryRow[];

  // 2. Pair user/assistant turns
  const pairs = pairConversations(memRows.reverse()); // ascending for pairing
  const sampleSize = Math.min(pairs.length, 15);

  let scores: RubricScores & { notes: string };
  if (sampleSize === 0) {
    // No data — return neutral scores
    scores = { relevance: 7, accuracy: 7, action_correctness: 7, calibration: 7, tone: 7, notes: "No conversation pairs found in window." };
  } else {
    // 4. Score with Claude Haiku
    scores = await scoreWithClaude(pairs);
  }

  // 5. Get prior week's scores
  const priorWeek = new Date(weekStart);
  priorWeek.setUTCDate(priorWeek.getUTCDate() - 7);
  const priorWeekStr = priorWeek.toISOString().slice(0, 10);

  const { data: priorRows } = await sb
    .from("mavis_eval_scores")
    .select("rubric, score")
    .eq("user_id", userId)
    .eq("week_start", priorWeekStr);

  const priorMap: Partial<Record<Rubric, number>> = {};
  for (const row of (priorRows ?? []) as { rubric: Rubric; score: number }[]) {
    priorMap[row.rubric] = row.score;
  }

  // 6. Compute deltas
  const deltas: Partial<Record<Rubric, number | null>> = {};
  for (const rubric of RUBRICS) {
    const prior = priorMap[rubric];
    deltas[rubric] = prior != null ? Number((scores[rubric] - prior).toFixed(2)) : null;
  }

  // 7. Insert new scores (upsert to avoid duplicate-key on retry)
  const upsertRows = RUBRICS.map((rubric) => ({
    user_id: userId,
    week_start: weekStartStr,
    rubric,
    score: scores[rubric],
    delta: deltas[rubric] ?? null,
    sample_size: sampleSize,
    notes: rubric === "relevance" ? scores.notes : null, // store notes on first rubric row
  }));

  const { error: upsertErr } = await sb
    .from("mavis_eval_scores")
    .upsert(upsertRows, { onConflict: "user_id,week_start,rubric" });

  if (upsertErr) throw new Error(`Score upsert error: ${upsertErr.message}`);

  // 8. Alert if any rubric dropped > 1.5 points
  const droppedRubrics = RUBRICS.filter(
    (r) => deltas[r] != null && (deltas[r] as number) < -1.5,
  );
  let alertFired = false;

  if (droppedRubrics.length > 0) {
    alertFired = true;
    const alertContent =
      `MAVIS quality alert: rubric(s) ${droppedRubrics.join(", ")} dropped >1.5 points this week. ` +
      `Deltas: ${droppedRubrics.map((r) => `${r}=${deltas[r]}`).join(", ")}. Scores: ${RUBRICS.map((r) => `${r}=${scores[r]}`).join(", ")}.`;

    await sb.from("mavis_memory").insert({
      user_id: userId,
      content: alertContent,
      role: "system",
      importance_score: 5,
      tags: ["eval", "quality-drop", "alert"],
      timestamp: Date.now(),
      consolidated: false,
    }).catch(() => {});
  }

  // 9. Write summary to mavis_memory
  const summaryContent =
    `Weekly eval (${weekStartStr}): ` +
    RUBRICS.map((r) => `${r}=${scores[r]}${deltas[r] != null ? `(Δ${deltas[r]! >= 0 ? "+" : ""}${deltas[r]})` : ""}`).join(", ") +
    `. Sample: ${sampleSize} pairs. ${scores.notes}`;

  await sb.from("mavis_memory").insert({
    user_id: userId,
    content: summaryContent,
    role: "system",
    importance_score: 3,
    tags: ["eval", "quality-metrics"],
    timestamp: Date.now(),
    consolidated: false,
  }).catch(() => {});

  // 10. Return result
  return {
    week_start: weekStartStr,
    scores: Object.fromEntries(RUBRICS.map((r) => [r, scores[r]])),
    deltas: Object.fromEntries(RUBRICS.map((r) => [r, deltas[r] ?? null])),
    sample_size: sampleSize,
    alert_fired: alertFired,
    notes: scores.notes,
  };
}

// ── Action: get_eval_history ──────────────────────────────────────────────────

async function getEvalHistory(
  sb: ReturnType<typeof createClient>,
  userId: string,
  weeks: number,
): Promise<unknown> {
  const { data, error } = await sb
    .from("mavis_eval_scores")
    .select("week_start, rubric, score, delta, sample_size, notes, created_at")
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(weeks * RUBRICS.length);

  if (error) throw new Error(`History fetch error: ${error.message}`);

  // Group by week
  const byWeek: Record<string, Record<string, unknown>> = {};
  for (const row of (data ?? []) as any[]) {
    const w = row.week_start as string;
    if (!byWeek[w]) byWeek[w] = { week_start: w, scores: {}, deltas: {}, sample_size: row.sample_size };
    (byWeek[w].scores as any)[row.rubric] = row.score;
    (byWeek[w].deltas as any)[row.rubric] = row.delta;
    if (row.notes) byWeek[w].notes = row.notes;
  }

  return { weeks: Object.values(byWeek) };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });

  // Resolve userId from JWT or body
  const jwtUserId = await resolveUserId(req, sb);
  const userId = (body.userId as string) ?? (body.user_id as string) ?? jwtUserId ?? "";

  if (!userId) {
    return jsonResp({ error: "userId required" }, 400);
  }

  const action = (body.action as string) ?? "evaluate_conversations";

  try {
    if (action === "evaluate_conversations") {
      const hoursBack = Number(body.hours_back ?? 168);
      const result = await evaluateConversations(sb, userId, hoursBack);
      return jsonResp({ ok: true, ...result as object });
    }

    if (action === "get_eval_history") {
      const weeks = Math.min(52, Number(body.weeks ?? 8));
      const result = await getEvalHistory(sb, userId, weeks);
      return jsonResp({ ok: true, ...result as object });
    }

    return jsonResp({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-eval]", message);
    return jsonResp({ error: message }, 500);
  }
});
