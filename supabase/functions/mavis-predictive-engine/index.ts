// mavis-predictive-engine
// Analyzes operator behavioral patterns and generates proactive intelligence
// Runs daily at 6am via pg_cron. Also callable on-demand.
// verify_jwt = false (pg_cron service-role trigger)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

interface MemoryRow {
  role: string;
  content: string;
  created_at: string;
  importance_score: number;
}

// ── Pattern analysis ──────────────────────────────────────────────────────────

function analyzeHourlyPattern(memories: MemoryRow[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const m of memories) {
    if (m.role !== "user") continue;
    const hour = new Date(m.created_at).getHours();
    counts[hour] = (counts[hour] ?? 0) + 1;
  }
  return counts;
}

function findPeakHours(hourly: Record<number, number>): number[] {
  const sorted = Object.entries(hourly)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([h]) => Number(h));
  return sorted;
}

function extractTopics(memories: MemoryRow[]): Map<string, number> {
  const topics = new Map<string, number>();
  const keywords = [
    "goal", "project", "task", "build", "launch", "health", "workout",
    "finance", "revenue", "client", "content", "research", "learning",
    "habit", "focus", "energy", "sleep", "meeting", "deadline",
  ];
  for (const m of memories) {
    const lower = (m.content ?? "").toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        topics.set(kw, (topics.get(kw) ?? 0) + 1);
      }
    }
  }
  return topics;
}

function analyzeHighImportanceGaps(memories: MemoryRow[]): number {
  const highImportance = memories.filter(m => m.importance_score >= 7 && m.role === "user");
  if (highImportance.length < 2) return 0;
  const latest = new Date(highImportance[0].created_at).getTime();
  const daysSince = (Date.now() - latest) / (1000 * 60 * 60 * 24);
  return Math.round(daysSince);
}

// ── Claude Haiku prediction generation ───────────────────────────────────────

async function generatePredictions(
  userId: string,
  patterns: {
    peakHours: number[];
    topTopics: [string, number][];
    memoryCount: number;
    highImportanceGapDays: number;
    hourlyActivity: Record<number, number>;
  }
): Promise<Array<{ type: string; title: string; content: string; confidence: number }>> {
  if (!ANTHROPIC_KEY) return [];

  const prompt = `You are MAVIS analyzing the operator's behavioral patterns to generate proactive intelligence.

PATTERN DATA (last 30 days):
- Peak activity hours: ${patterns.peakHours.map(h => `${h}:00`).join(", ")}
- Top topics: ${patterns.topTopics.slice(0, 8).map(([t, c]) => `${t}(${c}x)`).join(", ")}
- Total interactions: ${patterns.memoryCount}
- Days since high-importance interaction: ${patterns.highImportanceGapDays}

Generate 3-5 proactive intelligence predictions in JSON array format:
[
  {
    "type": "upcoming_need|behavioral_pattern|risk_alert|opportunity|productivity_window",
    "title": "Short title (max 60 chars)",
    "content": "Actionable insight (2-3 sentences)",
    "confidence": 0.0-1.0
  }
]

Rules:
- Be specific and actionable, not generic
- Focus on what MAVIS should prepare or alert the operator about
- Risk alerts for gaps/anomalies (e.g. no high-priority interactions in 5+ days = possible drift)
- Productivity windows for peak hours
- Opportunities based on topic clusters
- Return ONLY valid JSON array, no other text`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return [];
    const d = await res.json();
    const text = d.content?.find((b: any) => b.type === "text")?.text ?? "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}

// ── Process one user ──────────────────────────────────────────────────────────

async function processUser(userId: string): Promise<{
  predictions: number;
  patterns_updated: number;
}> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: memories } = await sb()
    .from("mavis_memory")
    .select("role, content, created_at, importance_score")
    .eq("user_id", userId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(500);

  if (!memories || memories.length < 10) {
    return { predictions: 0, patterns_updated: 0 };
  }

  // Analyze patterns
  const hourlyActivity = analyzeHourlyPattern(memories);
  const peakHours = findPeakHours(hourlyActivity);
  const topTopics = [...extractTopics(memories).entries()].sort(([, a], [, b]) => b - a);
  const highImportanceGapDays = analyzeHighImportanceGaps(memories);

  // Store behavioral patterns
  const patternData = {
    peak_hours: peakHours,
    top_topics: topTopics.slice(0, 10),
    hourly_activity: hourlyActivity,
    memory_count_30d: memories.length,
    high_importance_gap_days: highImportanceGapDays,
    updated_at: new Date().toISOString(),
  };

  await sb()
    .from("mavis_behavioral_patterns")
    .upsert({
      user_id: userId,
      pattern_type: "interaction_analysis",
      pattern_data: patternData,
      sample_size: memories.length,
      last_updated: new Date().toISOString(),
    }, { onConflict: "user_id,pattern_type" });

  // Generate AI predictions
  const rawPredictions = await generatePredictions(userId, {
    peakHours,
    topTopics,
    memoryCount: memories.length,
    highImportanceGapDays,
    hourlyActivity,
  });

  if (!rawPredictions.length) return { predictions: 0, patterns_updated: 1 };

  // Expire old predictions
  await sb()
    .from("mavis_predictions")
    .update({ expires_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("acted_on", false)
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  // Insert new predictions
  const validTypes = ["upcoming_need", "behavioral_pattern", "risk_alert", "opportunity", "health_insight", "productivity_window"];
  const toInsert = rawPredictions
    .filter(p => validTypes.includes(p.type) && p.title && p.content)
    .map(p => ({
      user_id: userId,
      prediction_type: p.type,
      title: String(p.title).slice(0, 200),
      content: String(p.content).slice(0, 2000),
      confidence: Math.min(1, Math.max(0, Number(p.confidence ?? 0.7))),
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    }));

  if (toInsert.length > 0) {
    await sb().from("mavis_predictions").insert(toInsert);

    // Fire push notify for high-confidence risk alerts
    const urgent = toInsert.filter(p => p.confidence >= 0.8 && p.prediction_type === "risk_alert");
    for (const u of urgent) {
      try {
        await fetch(`${SB_URL}/functions/v1/mavis-push-notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_KEY}` },
          body: JSON.stringify({
            user_id: userId,
            title: `MAVIS: ${u.title}`,
            body: u.content.slice(0, 200),
            type: "prediction_alert",
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch { /* non-fatal */ }
    }
  }

  return { predictions: toInsert.length, patterns_updated: 1 };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let body: any = {};
  try {
    if (req.method === "POST") body = await req.json().catch(() => ({}));
  } catch { /* ignore */ }

  const isCron = Boolean(body?.cron);

  let targetUserId: string | null = null;

  if (!isCron) {
    // User-triggered: validate JWT or service-role Bearer
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    // If it's a service-role call with explicit user_id
    if (body?.user_id && token === SB_KEY) {
      targetUserId = String(body.user_id);
    } else {
      const { data: { user } } = await createClient(SB_URL, SB_KEY).auth.getUser(token);
      targetUserId = user?.id ?? null;
    }

    if (!targetUserId) return json({ error: "Unauthorized" }, 401);
  }

  try {
    if (isCron) {
      // Process all active users (those with recent memory activity)
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: activeUsers } = await sb()
        .from("mavis_memory")
        .select("user_id")
        .gte("created_at", cutoff)
        .limit(100);

      const uniqueUsers = [...new Set((activeUsers ?? []).map((r: any) => r.user_id as string))];
      let totalPredictions = 0;

      for (const uid of uniqueUsers) {
        try {
          const result = await processUser(uid);
          totalPredictions += result.predictions;
        } catch (err: any) {
          console.error(`[predictive-engine] user ${uid} failed:`, err.message);
        }
      }

      return json({
        users_processed: uniqueUsers.length,
        total_predictions: totalPredictions,
      });
    } else {
      const result = await processUser(targetUserId!);
      return json(result);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[predictive-engine] Error:", message);
    return json({ error: message }, 500);
  }
});
