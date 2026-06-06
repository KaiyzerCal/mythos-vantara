// mavis-outcome-tracker
// Tracks every significant Mavis output (predictions, recommendations, outreach drafts,
// meeting preps, recovery plans, opportunities, causal actions) and periodically checks
// whether the predicted/expected outcome occurred. Stores accuracy data in mavis_tacit
// for the self-evolution engine.
//
// Modes:
//   POST { cron: true }                                          — fan out to all users (limit 50)
//   POST { user_id }                                             — run for single user
//   POST { action:"record", user_id, source_type, source_id,
//          prediction_text, predicted_outcome, due_days }        — record new outcome event
//   GET  ?user_id=...                                            — return events + stats
//
// verify_jwt = false (cron + service-role)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

function createSb() {
  return createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
}

// ── Claude Haiku helper ──────────────────────────────────────────────────────

async function callHaiku(system: string, user: string, maxTokens = 200): Promise<string> {
  if (!ANTHROPIC_KEY) return "";
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
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) return "";
    const d = await res.json();
    return d.content?.find((b: any) => b.type === "text")?.text ?? "";
  } catch {
    return "";
  }
}

// ── Outcome evaluation per source type ──────────────────────────────────────

interface OutcomeEvent {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string | null;
  prediction_text: string;
  predicted_outcome: string | null;
  actual_outcome: string | null;
  outcome_status: string;
  confidence_score: number | null;
  evidence_data: Record<string, unknown>;
  due_check_at: string;
  checked_at: string | null;
  created_at: string;
}

interface EvalResult {
  outcome_status: "confirmed" | "failed" | "partial" | "pending";
  actual_outcome: string;
  confidence_score: number;
}

async function evalPrediction(event: OutcomeEvent, sb: ReturnType<typeof createSb>): Promise<EvalResult> {
  // Look up mavis_predictions by source_id
  let predRow: any = null;
  if (event.source_id) {
    try {
      const { data } = await sb
        .from("mavis_predictions")
        .select("acted_on, content, title, triggers")
        .eq("id", event.source_id)
        .maybeSingle();
      predRow = data;
    } catch { /* non-fatal */ }
  }

  // Check quests/tasks that may have progressed
  let questUpdate = false;
  try {
    const sevenDaysAfter = new Date(new Date(event.created_at).getTime() + 7 * 86400000).toISOString();
    const { data: quests } = await sb
      .from("quests")
      .select("title, status, updated_at")
      .eq("user_id", event.user_id)
      .gte("updated_at", event.created_at)
      .lte("updated_at", sevenDaysAfter)
      .limit(5);
    questUpdate = (quests?.length ?? 0) > 0;
  } catch { /* non-fatal */ }

  if (!ANTHROPIC_KEY) {
    // Fallback without AI: acted_on or quest activity = confirmed
    if (predRow?.acted_on || questUpdate) {
      return { outcome_status: "confirmed", actual_outcome: "Prediction acted on or related activity detected.", confidence_score: 0.70 };
    }
    return { outcome_status: "failed", actual_outcome: "No action detected on prediction.", confidence_score: 0.50 };
  }

  const context = `Prediction: "${event.prediction_text}". Expected: "${event.predicted_outcome ?? "n/a"}". acted_on flag: ${predRow?.acted_on ?? "unknown"}. Quest activity after prediction: ${questUpdate ? "yes" : "no"}.`;
  const reply = await callHaiku(
    "You evaluate whether a prediction came true. Reply with JSON only: {\"status\":\"confirmed\"|\"failed\"|\"partial\",\"actual_outcome\":\"<1 sentence>\",\"confidence\":0.0-1.0}",
    context,
    120,
  );

  try {
    const parsed = JSON.parse(reply.trim());
    return {
      outcome_status: ["confirmed", "failed", "partial"].includes(parsed.status) ? parsed.status : "failed",
      actual_outcome: String(parsed.actual_outcome ?? "").slice(0, 500),
      confidence_score: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
    };
  } catch {
    return { outcome_status: "failed", actual_outcome: "Could not parse AI evaluation.", confidence_score: 0.50 };
  }
}

async function evalRecommendation(event: OutcomeEvent, sb: ReturnType<typeof createSb>): Promise<EvalResult> {
  // Check if related quest/task was updated within 7 days after the recommendation
  const sevenDaysAfter = new Date(new Date(event.created_at).getTime() + 7 * 86400000).toISOString();

  let taskUpdated = false;
  let questUpdated = false;

  try {
    const { data: tasks } = await sb
      .from("tasks")
      .select("id, title, updated_at")
      .eq("user_id", event.user_id)
      .gte("updated_at", event.created_at)
      .lte("updated_at", sevenDaysAfter)
      .limit(5);
    taskUpdated = (tasks?.length ?? 0) > 0;
  } catch { /* non-fatal */ }

  try {
    const { data: quests } = await sb
      .from("quests")
      .select("id, title, updated_at")
      .eq("user_id", event.user_id)
      .gte("updated_at", event.created_at)
      .lte("updated_at", sevenDaysAfter)
      .limit(5);
    questUpdated = (quests?.length ?? 0) > 0;
  } catch { /* non-fatal */ }

  if (taskUpdated || questUpdated) {
    return {
      outcome_status: "confirmed",
      actual_outcome: "Related quest or task was updated within 7 days of recommendation.",
      confidence_score: 0.75,
    };
  }

  // Check if still within 7-day window — keep pending
  if (new Date() < new Date(sevenDaysAfter)) {
    return {
      outcome_status: "pending",
      actual_outcome: "Still within 7-day follow-up window.",
      confidence_score: 0.50,
    };
  }

  return {
    outcome_status: "failed",
    actual_outcome: "No quest or task update detected within 7 days of recommendation.",
    confidence_score: 0.65,
  };
}

async function evalOutreach(event: OutcomeEvent, sb: ReturnType<typeof createSb>): Promise<EvalResult> {
  if (!event.source_id) {
    return { outcome_status: "failed", actual_outcome: "No source_id to look up outreach draft.", confidence_score: 0.50 };
  }

  try {
    const { data } = await sb
      .from("mavis_outreach_drafts")
      .select("status")
      .eq("id", event.source_id)
      .maybeSingle();

    if (!data) {
      return { outcome_status: "failed", actual_outcome: "Outreach draft not found.", confidence_score: 0.50 };
    }

    if (data.status === "sent" || data.status === "approved") {
      return { outcome_status: "confirmed", actual_outcome: `Outreach draft status: ${data.status}.`, confidence_score: 0.90 };
    }
    if (data.status === "skipped") {
      return { outcome_status: "failed", actual_outcome: "Outreach draft was skipped.", confidence_score: 0.90 };
    }
    // Still pending
    return { outcome_status: "pending", actual_outcome: "Outreach draft still pending.", confidence_score: 0.50 };
  } catch {
    return { outcome_status: "failed", actual_outcome: "Error looking up outreach draft.", confidence_score: 0.40 };
  }
}

async function evalRecoveryPlan(event: OutcomeEvent, sb: ReturnType<typeof createSb>): Promise<EvalResult> {
  // Quest id should be stored in evidence_data
  const questId = (event.evidence_data as any)?.quest_id as string | undefined;
  if (!questId) {
    return { outcome_status: "failed", actual_outcome: "No quest_id in evidence_data for recovery plan.", confidence_score: 0.40 };
  }

  try {
    const { data: quest } = await sb
      .from("quests")
      .select("updated_at, status")
      .eq("id", questId)
      .maybeSingle();

    if (!quest) {
      return { outcome_status: "failed", actual_outcome: "Quest not found.", confidence_score: 0.40 };
    }

    const questUpdatedAfter = quest.updated_at && new Date(quest.updated_at) > new Date(event.created_at);
    if (questUpdatedAfter) {
      return { outcome_status: "confirmed", actual_outcome: "Stalled quest was updated after recovery plan was created.", confidence_score: 0.80 };
    }

    // Check if 14 days have passed since plan creation
    const fourteenDaysAfter = new Date(new Date(event.created_at).getTime() + 14 * 86400000);
    if (new Date() > fourteenDaysAfter) {
      return { outcome_status: "failed", actual_outcome: "Quest still stalled 14+ days after recovery plan.", confidence_score: 0.80 };
    }

    return { outcome_status: "pending", actual_outcome: "Recovery plan within 14-day evaluation window.", confidence_score: 0.50 };
  } catch {
    return { outcome_status: "failed", actual_outcome: "Error looking up quest for recovery plan.", confidence_score: 0.40 };
  }
}

async function evalMeetingPrep(event: OutcomeEvent, sb: ReturnType<typeof createSb>): Promise<EvalResult> {
  if (!event.source_id) {
    return { outcome_status: "failed", actual_outcome: "No source_id for meeting prep.", confidence_score: 0.40 };
  }

  try {
    const { data } = await sb
      .from("mavis_meeting_preps")
      .select("prep_sent, event_start")
      .eq("id", event.source_id)
      .maybeSingle();

    if (!data) {
      return { outcome_status: "failed", actual_outcome: "Meeting prep record not found.", confidence_score: 0.40 };
    }

    const meetingPassed = data.event_start && new Date(data.event_start) < new Date();
    if (data.prep_sent && meetingPassed) {
      return { outcome_status: "confirmed", actual_outcome: "Meeting prep was sent and meeting time has passed.", confidence_score: 0.95 };
    }
    if (!data.prep_sent) {
      return { outcome_status: "failed", actual_outcome: "Meeting prep was not sent.", confidence_score: 0.80 };
    }
    // Prep sent but meeting hasn't happened yet
    return { outcome_status: "pending", actual_outcome: "Prep sent but meeting has not occurred yet.", confidence_score: 0.50 };
  } catch {
    return { outcome_status: "failed", actual_outcome: "Error looking up meeting prep.", confidence_score: 0.40 };
  }
}

async function evalOpportunityOrCausalAction(event: OutcomeEvent, sb: ReturnType<typeof createSb>): Promise<EvalResult> {
  // Fetch current quest/task state for context
  let questContext = "";
  let taskContext = "";

  try {
    const { data: quests } = await sb
      .from("quests")
      .select("title, status, updated_at")
      .eq("user_id", event.user_id)
      .order("updated_at", { ascending: false })
      .limit(10);
    questContext = (quests ?? []).map((q: any) => `${q.title}(${q.status})`).join(", ");
  } catch { /* non-fatal */ }

  try {
    const { data: tasks } = await sb
      .from("tasks")
      .select("title, status, updated_at")
      .eq("user_id", event.user_id)
      .order("updated_at", { ascending: false })
      .limit(10);
    taskContext = (tasks ?? []).map((t: any) => `${t.title}(${t.status})`).join(", ");
  } catch { /* non-fatal */ }

  if (!ANTHROPIC_KEY) {
    return { outcome_status: "failed", actual_outcome: "No AI key to evaluate opportunity/action.", confidence_score: 0.40 };
  }

  const context = `${event.source_type === "opportunity" ? "Opportunity" : "Causal action"} description: "${event.prediction_text}". Expected: "${event.predicted_outcome ?? "n/a"}". Created: ${event.created_at}. Current quest state: ${questContext || "none"}. Current task state: ${taskContext || "none"}.`;

  const reply = await callHaiku(
    "You determine whether an operator acted on an opportunity or causal action recommendation. Reply with JSON only: {\"status\":\"confirmed\"|\"failed\"|\"unknown\",\"actual_outcome\":\"<1 sentence>\",\"confidence\":0.0-1.0}",
    context,
    120,
  );

  try {
    const parsed = JSON.parse(reply.trim());
    const statusMap: Record<string, "confirmed" | "failed" | "partial"> = {
      confirmed: "confirmed",
      failed: "failed",
      unknown: "partial",
    };
    return {
      outcome_status: statusMap[parsed.status] ?? "partial",
      actual_outcome: String(parsed.actual_outcome ?? "").slice(0, 500),
      confidence_score: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
    };
  } catch {
    return { outcome_status: "partial", actual_outcome: "Could not parse AI evaluation.", confidence_score: 0.40 };
  }
}

async function evaluateEvent(event: OutcomeEvent, sb: ReturnType<typeof createSb>): Promise<EvalResult> {
  switch (event.source_type) {
    case "prediction":
      return evalPrediction(event, sb);
    case "recommendation":
      return evalRecommendation(event, sb);
    case "outreach":
      return evalOutreach(event, sb);
    case "recovery_plan":
      return evalRecoveryPlan(event, sb);
    case "meeting_prep":
      return evalMeetingPrep(event, sb);
    case "opportunity":
    case "causal_action":
      return evalOpportunityOrCausalAction(event, sb);
    default:
      return { outcome_status: "failed", actual_outcome: "Unknown source_type.", confidence_score: 0.40 };
  }
}

// ── Running accuracy upsert into mavis_tacit ─────────────────────────────────

async function updateAccuracyTacit(
  userId: string,
  sourceType: string,
  evalStatus: "confirmed" | "failed" | "partial" | "pending",
  sb: ReturnType<typeof createSb>,
): Promise<void> {
  if (evalStatus === "pending") return; // don't count unresolved events

  const tacitKey = `outcome_accuracy_${sourceType}`;

  try {
    // Fetch existing tacit row
    const { data: existing } = await sb
      .from("mavis_tacit")
      .select("value")
      .eq("user_id", userId)
      .eq("key", tacitKey)
      .maybeSingle();

    let stats: { total: number; confirmed: number; failed: number; partial: number; accuracy: number } = {
      total: 0,
      confirmed: 0,
      failed: 0,
      partial: 0,
      accuracy: 0,
    };

    if (existing?.value) {
      try {
        const parsed = JSON.parse(existing.value);
        stats = { ...stats, ...parsed };
      } catch { /* start fresh */ }
    }

    stats.total += 1;
    if (evalStatus === "confirmed") stats.confirmed += 1;
    else if (evalStatus === "failed") stats.failed += 1;
    else if (evalStatus === "partial") stats.partial += 1;

    const resolved = stats.confirmed + stats.failed + stats.partial;
    stats.accuracy = resolved > 0 ? Math.round((stats.confirmed / resolved) * 100) / 100 : 0;

    await sb
      .from("mavis_tacit")
      .upsert(
        {
          user_id: userId,
          category: "lesson_learned",
          key: tacitKey,
          value: JSON.stringify(stats),
          source: "mavis-outcome-tracker",
          confidence: 7,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,key" },
      );
  } catch (err) {
    console.error("[outcome-tracker] tacit upsert error:", err);
  }
}

// ── Core check function ──────────────────────────────────────────────────────

async function checkOutcomes(userId: string, sb: ReturnType<typeof createSb>): Promise<number> {
  let checked = 0;

  try {
    const { data: events, error } = await sb
      .from("mavis_outcome_events")
      .select("*")
      .eq("user_id", userId)
      .eq("outcome_status", "pending")
      .lte("due_check_at", new Date().toISOString());

    if (error || !events?.length) return 0;

    for (const event of events as OutcomeEvent[]) {
      try {
        const result = await evaluateEvent(event, sb);

        // Only persist if we got a definitive answer (not still pending)
        if (result.outcome_status !== "pending") {
          await sb
            .from("mavis_outcome_events")
            .update({
              outcome_status: result.outcome_status,
              actual_outcome: result.actual_outcome,
              confidence_score: result.confidence_score,
              checked_at: new Date().toISOString(),
            })
            .eq("id", event.id);

          await updateAccuracyTacit(userId, event.source_type, result.outcome_status, sb);
          checked++;
        }
      } catch (evErr) {
        console.error("[outcome-tracker] event eval error:", evErr);
      }
    }
  } catch (err) {
    console.error("[outcome-tracker] checkOutcomes error:", err);
  }

  return checked;
}

// ── Stats helper ─────────────────────────────────────────────────────────────

async function getStats(userId: string, sb: ReturnType<typeof createSb>) {
  const { data: events } = await sb
    .from("mavis_outcome_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (events ?? []) as OutcomeEvent[];

  // Build per-type accuracy
  const byType: Record<string, { total: number; confirmed: number; failed: number; partial: number; accuracy: number }> = {};

  for (const row of rows) {
    if (!byType[row.source_type]) {
      byType[row.source_type] = { total: 0, confirmed: 0, failed: 0, partial: 0, accuracy: 0 };
    }
    const t = byType[row.source_type];
    t.total += 1;
    if (row.outcome_status === "confirmed") t.confirmed += 1;
    else if (row.outcome_status === "failed") t.failed += 1;
    else if (row.outcome_status === "partial") t.partial += 1;
  }

  // Compute accuracy per type
  for (const key of Object.keys(byType)) {
    const t = byType[key];
    const resolved = t.confirmed + t.failed + t.partial;
    t.accuracy = resolved > 0 ? Math.round((t.confirmed / resolved) * 100) / 100 : 0;
  }

  // Overall accuracy
  const allResolved = rows.filter((r) => ["confirmed", "failed", "partial"].includes(r.outcome_status));
  const allConfirmed = allResolved.filter((r) => r.outcome_status === "confirmed").length;
  const overall_accuracy = allResolved.length > 0
    ? Math.round((allConfirmed / allResolved.length) * 100) / 100
    : 0;

  return {
    events: rows,
    accuracy_by_type: byType,
    overall_accuracy,
  };
}

// ── Main serve handler ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Auth check — accept service-role key as bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token && token !== SB_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createSb();

  try {
    // ── GET: return recent events + stats ──────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "user_id required" }, 400);
      const stats = await getStats(userId, sb);
      return json(stats);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ── POST action=record: record a new outcome event ─────────────────────
    if (body.action === "record") {
      const { user_id, source_type, source_id, prediction_text, predicted_outcome, due_days } = body;
      if (!user_id || !source_type || !prediction_text) {
        return json({ error: "user_id, source_type, and prediction_text are required" }, 400);
      }

      const dueDays = Number(due_days) || 3;
      const dueCheckAt = new Date(Date.now() + dueDays * 86400000).toISOString();

      const { data, error } = await sb
        .from("mavis_outcome_events")
        .insert({
          user_id,
          source_type,
          source_id: source_id ?? null,
          prediction_text,
          predicted_outcome: predicted_outcome ?? null,
          outcome_status: "pending",
          due_check_at: dueCheckAt,
        })
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ recorded: true, event: data });
    }

    // ── POST cron: fan out to all users ────────────────────────────────────
    if (body.cron === true) {
      const { data: users } = await sb
        .from("profiles")
        .select("id")
        .limit(50);

      if (!users?.length) return json({ checked: 0 });

      let totalChecked = 0;
      for (const { id: userId } of users) {
        try {
          totalChecked += await checkOutcomes(userId, sb);
        } catch { /* per-user error — continue */ }
      }

      return json({ checked: totalChecked, users: users.length });
    }

    // ── POST single user ───────────────────────────────────────────────────
    const userId = String(body.user_id ?? "").trim();
    if (!userId) return json({ error: "user_id required" }, 400);

    const checked = await checkOutcomes(userId, sb);
    return json({ checked, user_id: userId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[outcome-tracker]", msg);
    return json({ error: msg }, 500);
  }
});
