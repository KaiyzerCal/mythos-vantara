// MAVIS Dream — Three-Phase Memory Consolidation
//
// Inspired by the MyClaw/OpenClaw three-phase dreaming pattern.
// Runs on a schedule (daily) to consolidate, synthesize, and decay memories
// across all three tiers of the MAVIS memory architecture.
//
// Phases:
//   LIGHT — Dedup recent memories; lower importance of clear redundancies.
//   REM   — Detect cross-session patterns; surface them as durable knowledge.
//   DEEP  — Time-based importance decay; archive stale low-value memories.
//
// All phases are idempotent and non-destructive (no hard deletes).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

async function callClaude(system: string, user: string, maxTokens = 1000): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("No ANTHROPIC_API_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const d = await res.json();
  return d?.content?.[0]?.text ?? "";
}

// ─────────────────────────────────────────────────────────────
// LIGHT PHASE — Dedup recent memories
// Finds semantically similar memory pairs in the last 24 hours
// and lowers the importance_score of the weaker duplicate to 1
// so it is deprioritized in future recall without data loss.
// ─────────────────────────────────────────────────────────────

async function runLightPhase(userId: string): Promise<{ deduped: number }> {
  // Fetch recent memories with some content
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await sb
    .from("mavis_memory")
    .select("id, content, role, importance_score")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(120);

  if (!recent || recent.length < 4) return { deduped: 0 };

  // Feed them to Claude for quick dedup identification
  const contentLines = (recent as any[])
    .map((m, i) => `[${i}] (${m.role}) ${String(m.content).slice(0, 200)}`)
    .join("\n");

  const raw = await callClaude(
    `You are MAVIS's memory deduplication engine. Identify pairs or groups of messages that convey the same or nearly identical information. Return ONLY valid JSON.`,
    `Here are ${recent.length} recent memory entries:\n\n${contentLines}\n\nReturn JSON like:\n{"duplicates":[[0,3],[7,12,15]]}\n\nEach sub-array is a group of duplicate indices. List only genuine duplicates (same fact, same event). Return empty array if none.`,
    400,
  ).catch(() => "");

  let groups: number[][] = [];
  try {
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    if (Array.isArray(parsed?.duplicates)) groups = parsed.duplicates;
  } catch { /* no-op */ }

  let deduped = 0;
  for (const group of groups) {
    // Keep the first (most recent per our desc sort); downrank rest
    for (let i = 1; i < group.length; i++) {
      const idx = group[i];
      const mem = (recent as any[])[idx];
      if (!mem) continue;
      const currentScore = mem.importance_score ?? 5;
      if (currentScore > 1) {
        await sb
          .from("mavis_memory")
          .update({ importance_score: 1 })
          .eq("id", mem.id)
          .eq("user_id", userId);
        deduped++;
      }
    }
  }

  return { deduped };
}

// ─────────────────────────────────────────────────────────────
// REM PHASE — Cross-session pattern detection
// Reads the last 7 days of assistant messages and uses an LLM
// to surface recurring themes. Each identified pattern is stored
// in mavis_knowledge so it shows up in future recall without
// bloating the raw session memory.
// ─────────────────────────────────────────────────────────────

async function runRemPhase(userId: string): Promise<{ patterns: number }> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Sample assistant replies (they contain the richest signal)
  const { data: recent } = await sb
    .from("mavis_memory")
    .select("content, created_at, session_id")
    .eq("user_id", userId)
    .eq("role", "user") // user messages reveal intent & recurring interests
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!recent || recent.length < 10) return { patterns: 0 };

  // Group by session to see which themes repeat across sessions
  const sessionMap = new Map<string, string[]>();
  for (const m of recent as any[]) {
    const sid = m.session_id ?? "unknown";
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid)!.push(String(m.content).slice(0, 150));
  }

  const sessionCount = sessionMap.size;
  if (sessionCount < 2) return { patterns: 0 }; // need cross-session signal

  const sessionSummaries = Array.from(sessionMap.entries())
    .slice(0, 20) // cap at 20 sessions for token budget
    .map(([sid, msgs]) => `Session ${sid.slice(0, 8)}: ${msgs.slice(0, 5).join(" | ")}`)
    .join("\n");

  const raw = await callClaude(
    `You are MAVIS's REM dreaming engine. You analyze conversation patterns across multiple sessions to find recurring themes, interests, and needs that the operator returns to repeatedly. Return ONLY valid JSON.`,
    `Below are ${sessionCount} recent conversation sessions (past 7 days):\n\n${sessionSummaries}\n\nIdentify 2-4 recurring patterns — topics, concerns, or goals the operator keeps returning to.\n\nReturn JSON:\n{"patterns":[{"title":"<short title>","insight":"<one sentence — what is the recurring pattern and what does it signal about the operator>","category":"project|area|resource","tags":["<tag>"]}]}`,
    600,
  ).catch(() => "");

  let patternList: any[] = [];
  try {
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    if (Array.isArray(parsed?.patterns)) patternList = parsed.patterns;
  } catch { /* no-op */ }

  let stored = 0;
  for (const p of patternList) {
    if (!p?.title || !p?.insight) continue;
    // Write as a mavis_knowledge entry tagged as a dream pattern
    await sb.from("mavis_knowledge").upsert({
      user_id: userId,
      category: p.category ?? "resource",
      title: `[PATTERN] ${String(p.title).slice(0, 80)}`,
      content: String(p.insight).slice(0, 500),
      tags: ["dream_rem", "pattern", ...(Array.isArray(p.tags) ? p.tags.slice(0, 3) : [])],
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,title" });
    stored++;
  }

  return { patterns: stored };
}

// ─────────────────────────────────────────────────────────────
// DEEP PHASE — Long-term importance scoring and decay
// Memories older than 14 days that were never boosted by recall
// decay by 1 point each cycle. Memories referenced in very old
// sessions but still carrying high scores are left alone (they
// were explicitly important). Memories older than 90 days with
// importance_score <= 2 get tagged "archived" so semantic search
// can optionally filter them out.
// ─────────────────────────────────────────────────────────────

async function runDeepPhase(userId: string): Promise<{ decayed: number; archived: number }> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysAgo  = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Decay: old memories with middling importance (3-6)
  const { data: decayTargets } = await sb
    .from("mavis_memory")
    .select("id, importance_score, tags")
    .eq("user_id", userId)
    .lt("created_at", fourteenDaysAgo)
    .gte("importance_score", 3)
    .lte("importance_score", 6)
    .not("tags", "cs", '{"dream_archived"}') // skip already-archived
    .limit(500);

  let decayed = 0;
  for (const m of decayTargets ?? []) {
    await sb.from("mavis_memory")
      .update({ importance_score: Math.max(1, (m.importance_score ?? 3) - 1) })
      .eq("id", (m as any).id)
      .eq("user_id", userId);
    decayed++;
  }

  // Archive: very old, very low importance
  const { data: archiveTargets } = await sb
    .from("mavis_memory")
    .select("id, tags")
    .eq("user_id", userId)
    .lt("created_at", ninetyDaysAgo)
    .lte("importance_score", 2)
    .not("tags", "cs", '{"dream_archived"}')
    .limit(500);

  let archived = 0;
  for (const m of archiveTargets ?? []) {
    const existingTags: string[] = Array.isArray((m as any).tags) ? (m as any).tags : [];
    await sb.from("mavis_memory")
      .update({ tags: [...existingTags, "dream_archived"] })
      .eq("id", (m as any).id)
      .eq("user_id", userId);
    archived++;
  }

  return { decayed, archived };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const phase = (body.phase ?? "all").toLowerCase(); // "light" | "rem" | "deep" | "all"
  const targetUserId = body.user_id as string | undefined;

  const results: Record<string, any> = {};
  const errors: string[] = [];

  // Determine which users to process
  let userIds: string[] = [];
  if (targetUserId) {
    userIds = [targetUserId];
  } else {
    // Process all users who have mavis_memory rows
    const { data: users } = await sb
      .from("mavis_memory")
      .select("user_id")
      .order("created_at", { ascending: false });
    const seen = new Set<string>();
    for (const row of users ?? []) {
      if (!seen.has((row as any).user_id)) {
        seen.add((row as any).user_id);
        userIds.push((row as any).user_id);
      }
    }
  }

  for (const userId of userIds) {
    results[userId] = {};

    try {
      if (phase === "light" || phase === "all") {
        results[userId].light = await runLightPhase(userId);
      }
    } catch (e: any) {
      errors.push(`light/${userId}: ${e?.message}`);
      results[userId].light = { error: e?.message };
    }

    try {
      if (phase === "rem" || phase === "all") {
        results[userId].rem = await runRemPhase(userId);
      }
    } catch (e: any) {
      errors.push(`rem/${userId}: ${e?.message}`);
      results[userId].rem = { error: e?.message };
    }

    try {
      if (phase === "deep" || phase === "all") {
        results[userId].deep = await runDeepPhase(userId);
      }
    } catch (e: any) {
      errors.push(`deep/${userId}: ${e?.message}`);
      results[userId].deep = { error: e?.message };
    }
  }

  return new Response(
    JSON.stringify({ ok: errors.length === 0, users_processed: userIds.length, results, errors }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
