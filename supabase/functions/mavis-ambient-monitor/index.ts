// mavis-ambient-monitor
// Always-on ambient brain — runs every 5 minutes via pg_cron.
// No user JWT required; uses service role to scan all recently-active users
// and proactively insert tasks, insights, and ambient event records.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

const PRIORITY_KEYWORDS = ["invoice", "contract", "deadline", "urgent", "asap", "legal"];

// ── Helpers ────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86400 * 1000).toISOString();
}

/** Fire-and-forget call to another edge function. */
async function callEdgeFunction(
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${SB_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SB_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // non-fatal — best-effort push
  }
}

/** Send a Telegram message with MarkdownV2 parse_mode. Non-fatal on failure. */
async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // non-fatal
  }
}

/** Call Claude Haiku for a short generation task. Returns the text content. */
async function callHaiku(systemPrompt: string, userMessage: string, maxTokens = 300): Promise<string> {
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
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return data?.content?.[0]?.text?.trim() ?? "";
  } catch {
    return "";
  }
}

// ── Per-user checks ────────────────────────────────────────────────────────

interface CheckResult {
  issues: number;
  actions: number;
  details: Record<string, unknown>;
}

/** Check 1: overdue active quests */
async function checkOverdueQuests(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  const { data: quests, error } = await sb
    .from("quests")
    .select("id, title")
    .eq("user_id", userId)
    .eq("status", "active")
    .lt("deadline", nowIso())
    .not("deadline", "is", null);

  if (error || !quests || quests.length === 0) return result;

  const count = quests.length;
  const titles = quests.map((q: any) => q.title).join(", ");
  const ids = quests.map((q: any) => q.id);

  await sb.from("mavis_tasks").insert({
    user_id: userId,
    type: "goal",
    description: `Review and rescue ${count} overdue quest(s): ${titles}`,
    payload: {
      objective: `Rescue ${count} overdue quest(s)`,
      quests: ids,
    },
    status: "pending",
  });

  result.issues = count;
  result.actions = 1;
  result.details = { overdue_quests: count, titles };
  return result;
}

/** Check 2: health anomaly detection */
async function checkHealthAnomalies(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  // Query the metric-type/value style table (20260518040000 schema)
  const { data: metrics, error } = await sb
    .from("health_metrics")
    .select("metric_type, value, metric_date, created_at")
    .eq("user_id", userId)
    .gte("created_at", daysAgo(2))
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !metrics || metrics.length === 0) return result;

  const anomalies: string[] = [];

  for (const m of metrics as any[]) {
    const v = Number(m.value);
    const t = String(m.metric_type ?? "").toLowerCase();
    if (t === "hrv" && v < 30) anomalies.push(`HRV ${v} (< 30)`);
    if ((t === "resting_hr" || t === "resting_heart_rate") && v > 90)
      anomalies.push(`Resting HR ${v} (> 90)`);
    if ((t === "sleep_score" || t === "readiness") && v < 60)
      anomalies.push(`${m.metric_type} ${v} (< 60)`);
  }

  // Deduplicate
  const unique = [...new Set(anomalies)];
  if (unique.length === 0) return result;

  const details = unique.join("; ");

  await sb.from("mavis_insights").insert({
    user_id: userId,
    title: "Health Alert",
    content: `Anomaly detected: ${details}`,
    category: "health",
    severity: "warning",
    generated_at: nowIso(),
  });

  await sb.from("mavis_tasks").insert({
    user_id: userId,
    type: "health",
    description: `Health anomaly detected: ${details}. Consider adjusting training intensity or recovery plan.`,
    payload: { anomalies: unique },
    status: "pending",
  });

  result.issues = unique.length;
  result.actions = 2;
  result.details = { health_anomalies: unique };
  return result;
}

/** Check 3: unread priority emails in the last 24 h */
async function checkPriorityEmails(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  let emails: any[] | null = null;

  try {
    const { data, error } = await sb
      .from("gmail_messages")
      .select("id, subject, from_email, received_at")
      .eq("user_id", userId)
      .eq("is_read", false)
      .gte("received_at", hoursAgo(24))
      .order("received_at", { ascending: false })
      .limit(5);

    if (!error && data) emails = data;
  } catch {
    // table may not exist yet — skip gracefully
    return result;
  }

  if (!emails || emails.length === 0) return result;

  const priority = emails.filter((e: any) => {
    const subj = String(e.subject ?? "").toLowerCase();
    return PRIORITY_KEYWORDS.some((kw) => subj.includes(kw));
  });

  if (priority.length === 0) return result;

  const subjects = priority.map((e: any) => `• ${e.subject} (from: ${e.from_email})`).join("\n");

  await sb.from("mavis_insights").insert({
    user_id: userId,
    title: "Priority Emails Detected",
    content: `${priority.length} unread priority email(s) in the last 24 h:\n${subjects}`,
    category: "communication",
    severity: "warning",
    generated_at: nowIso(),
  });

  result.issues = priority.length;
  result.actions = 1;
  result.details = { priority_emails: priority.length, subjects: priority.map((e: any) => e.subject) };
  return result;
}

/** Check 4: revenue discussion gap — nudge if no talk in 7 days */
async function checkRevenueMentions(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  const { data, error } = await sb
    .from("mavis_memory")
    .select("created_at")
    .eq("user_id", userId)
    .eq("role", "assistant")
    .ilike("content", "%revenue%")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) return result;

  const rows = data ?? [];
  if (rows.length > 0) {
    const latest = new Date(rows[0].created_at).getTime();
    const sevenDaysMs = 7 * 86400 * 1000;
    if (Date.now() - latest < sevenDaysMs) return result; // discussed recently
  }

  // No revenue discussion in 7+ days
  await sb.from("mavis_tasks").insert({
    user_id: userId,
    type: "business",
    description:
      "No revenue or business metrics discussed in the last 7 days. Consider reviewing your income streams, pipeline, or financial goals.",
    payload: { trigger: "revenue_silence_7d" },
    status: "pending",
  });

  result.issues = 1;
  result.actions = 1;
  result.details = { revenue_gap: true, last_discussed: rows[0]?.created_at ?? null };
  return result;
}

/** Check 5: upcoming calendar events in the next 2 hours */
async function checkUpcomingEvents(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  const windowEnd = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  let events: any[] | null = null;

  try {
    const { data, error } = await sb
      .from("calendar_events")
      .select("id, title, start_time, location")
      .eq("user_id", userId)
      .gte("start_time", nowIso())
      .lte("start_time", windowEnd)
      .order("start_time", { ascending: true });

    if (!error && data) events = data;
  } catch {
    // table may not exist yet
    return result;
  }

  if (!events || events.length === 0) return result;

  const eventList = events
    .map((e: any) => {
      const t = new Date(e.start_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      return `${t} — ${e.title}${e.location ? ` (${e.location})` : ""}`;
    })
    .join(", ");

  await sb.from("mavis_tasks").insert({
    user_id: userId,
    type: "calendar",
    description: `Upcoming in the next 2 hours: ${eventList}. Prepare and review any relevant materials.`,
    payload: {
      events: events.map((e: any) => ({ id: e.id, title: e.title, start_time: e.start_time })),
    },
    status: "pending",
  });

  result.issues = events.length;
  result.actions = 1;
  result.details = { upcoming_events: events.length, events: eventList };
  return result;
}

// ── New proactive orchestration checks ────────────────────────────────────

/**
 * Check 6: Dormant Contact Outreach
 * Queries mavis_relationship_intel for high-value contacts with no contact in 60+ days,
 * drafts a personalized outreach message via Claude Haiku, and sends a Telegram approval nudge.
 * Gracefully skips if the table does not exist yet.
 */
async function checkDormantContacts(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  try {
    // Ensure the outreach_drafts table exists (inline DDL — idempotent)
    await sb.rpc("query" as any, {
      query: `
        CREATE TABLE IF NOT EXISTS public.mavis_outreach_drafts (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references auth.users(id) on delete cascade,
          contact_name text not null,
          drafted_message text not null,
          status text not null default 'pending',
          created_at timestamptz not null default now()
        );
        ALTER TABLE public.mavis_outreach_drafts ENABLE ROW LEVEL SECURITY;
        DO $$ BEGIN
          CREATE POLICY "Users see own drafts" ON public.mavis_outreach_drafts FOR SELECT USING (auth.uid() = user_id);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN
          CREATE INDEX IF NOT EXISTS idx_outreach_drafts_user_created ON public.mavis_outreach_drafts(user_id, created_at DESC);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `,
    }).catch(() => {
      // rpc may not exist; the migration handles table creation
    });

    // Query dormant high-value contacts from mavis_relationship_health
    // (populated by mavis-relationship-intel). Dormant = 60+ days since contact
    // and a healthy relationship score (>= 6/10).
    const { data: rows, error } = await sb
      .from("mavis_relationship_health")
      .select("id, contact_name, days_since_contact, health_score, notes, suggested_action")
      .eq("user_id", userId)
      .gte("days_since_contact", 60)
      .gte("health_score", 6)
      .order("health_score", { ascending: false })
      .limit(3);

    if (error) {
      // Table doesn't exist yet — skip gracefully
      if (error.code === "42P01" || error.message?.includes("does not exist")) return result;
      return result;
    }
    if (!rows || rows.length === 0) return result;
    // Normalize to the shape the loop below expects.
    const contacts = rows.map((r: any) => ({
      id: r.id,
      contact_name: r.contact_name,
      days_since_contact: r.days_since_contact,
      shared_history_notes: r.notes || r.suggested_action || "",
    }));

    // Fetch operator's active quests for personalization context
    const { data: activeQuests } = await sb
      .from("quests")
      .select("title")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(3);
    const projectContext = (activeQuests ?? []).map((q: any) => q.title).join(", ") || "various personal projects";

    for (const contact of contacts as any[]) {
      try {
        const daysSince = Number(contact.days_since_contact) || 60;
        const historyNotes = contact.shared_history_notes || "No specific history recorded.";

        const systemPrompt = `You are Mavis, an elite AI personal operating system.
Draft a warm, genuine, personalized outreach message (2-3 sentences max) from the operator to reconnect with a contact they haven't spoken to in a while.
The message should feel human, not templated. Reference something specific about the relationship or shared context if available.
Output ONLY the message text, no preamble.`;

        const userMsg = `Contact: ${contact.contact_name}
Days since last contact: ${daysSince}
Shared history / notes: ${historyNotes}
Operator's current projects: ${projectContext}

Draft a short, warm reconnect message.`;

        const drafted = await callHaiku(systemPrompt, userMsg, 200);
        if (!drafted) continue;

        // Insert draft to outreach_drafts table
        const { data: draftRow } = await sb
          .from("mavis_outreach_drafts" as any)
          .insert({
            user_id: userId,
            contact_name: contact.contact_name,
            drafted_message: drafted,
            status: "pending",
          })
          .select("id")
          .single();

        const draftId = draftRow?.id ?? contact.id;

        // Queue as a requires_confirmation task so /approve [id] works from Telegram
        const contactEmail: string = (contact as any).email ?? (contact as any).contact_email ?? "";
        const { data: taskRow } = await sb.from("mavis_tasks").insert({
          user_id: userId,
          type: "send_outreach",
          description: `Reconnect with ${contact.contact_name} — ${daysSince} days dormant`,
          payload: {
            draft_id: draftId,
            contact_name: contact.contact_name,
            message: drafted,
            contact_email: contactEmail,
          },
          status: "requires_confirmation",
        }).select("id").single();

        const taskId: string = (taskRow as any)?.id ?? draftId;
        const shortId = String(taskId).slice(0, 8);

        // Send Telegram nudge using the standard /approve [id] format
        const tgMessage = `💬 *Reconnect Nudge*
You haven't spoken to *${contact.contact_name}* in ${daysSince} days\\.

Draft message ready:
_"${drafted.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&")}"_

Reply \`/approve ${shortId}\` to send or \`/reject ${shortId}\` to skip\\.`;

        await sendTelegram(tgMessage);

        result.issues++;
        result.actions++;
      } catch (contactErr) {
        console.error(`[ambient-monitor] Error processing dormant contact:`, contactErr);
      }
    }

    result.details = { dormant_contacts_processed: result.issues };
  } catch (err) {
    console.error("[ambient-monitor] checkDormantContacts error:", err);
  }

  return result;
}

/**
 * Check 7: Stalled Quest Recovery
 * Finds active quests with no task updated in 14+ days, generates a 3-step recovery plan
 * via Claude Haiku, and sends a Telegram alert. Inserts recovery actions as new tasks.
 */
async function checkStalledQuests(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  try {
    const fourteenDaysAgo = daysAgo(14);

    // Find active quests that haven't been updated in 14+ days
    const { data: stalledQuests, error } = await sb
      .from("quests")
      .select("id, title, description, category, updated_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .lt("updated_at", fourteenDaysAgo)
      .order("updated_at", { ascending: true })
      .limit(3);

    if (error || !stalledQuests || stalledQuests.length === 0) return result;

    for (const quest of stalledQuests as any[]) {
      try {
        const daysSinceUpdate = Math.floor(
          (Date.now() - new Date(quest.updated_at).getTime()) / 86400000,
        );

        const systemPrompt = `You are Mavis, an elite AI personal operating system.
Your operator has a stalled quest (goal/project). Generate exactly 3 concrete, actionable next steps to restart momentum.
Format your response as a JSON array of 3 strings, each a brief action (under 15 words).
Output ONLY valid JSON, no markdown, no preamble. Example: ["Action one here","Action two here","Action three here"]`;

        const userMsg = `Quest title: ${quest.title}
Quest description: ${quest.description || "No description"}
Category: ${quest.category || "general"}
Stalled for: ${daysSinceUpdate} days

Generate 3 concrete next actions to restart this quest.`;

        const rawPlan = await callHaiku(systemPrompt, userMsg, 200);

        let actions: string[] = [];
        try {
          actions = JSON.parse(rawPlan);
          if (!Array.isArray(actions)) actions = [];
          actions = actions.slice(0, 3).map((a: any) => String(a));
        } catch {
          // Fallback: try to extract lines
          actions = rawPlan
            .split("\n")
            .map((l) => l.replace(/^[\d\.\-\*]+\s*/, "").trim())
            .filter((l) => l.length > 0)
            .slice(0, 3);
        }

        if (actions.length === 0) {
          actions = [
            "Review the quest objectives and re-clarify the goal",
            "Identify the single smallest next step to make progress",
            "Block 30 minutes on your calendar to restart this week",
          ];
        }

        // Send Telegram alert
        const actionLines = actions.map((a, i) => `${i + 1}. ${a}`).join("\n");
        const tgMessage = `⚠️ *Quest Stalled*: ${quest.title}
Stalled for ${daysSinceUpdate} days.

Recovery plan:
${actionLines}`;

        await sendTelegram(tgMessage);

        // Batch-insert all recovery actions in one round-trip
        await sb.from("mavis_tasks").insert(
          actions.map((action) => ({
            user_id: userId,
            type: "goal",
            description: action,
            payload: { quest_id: quest.id, quest_title: quest.title, trigger: "stalled_quest_recovery" },
            status: "pending",
          }))
        ).catch((e: any) => console.error("[ambient-monitor] batch task insert error:", e));

        result.issues++;
        result.actions += actions.length;
      } catch (questErr) {
        console.error(`[ambient-monitor] Error processing stalled quest:`, questErr);
      }
    }

    result.details = { stalled_quests_processed: result.issues };
  } catch (err) {
    console.error("[ambient-monitor] checkStalledQuests error:", err);
  }

  return result;
}

/**
 * Check 8: Proactive Opportunity Linking
 * Queries mavis_opportunities for recent unacted-on opportunities, correlates them with
 * active quests and recent journal/notes context, and sends a Telegram brief.
 * Gracefully handles missing tables.
 */
async function checkOpportunityLinks(
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<CheckResult> {
  const result: CheckResult = { issues: 0, actions: 0, details: {} };

  try {
    const sevenDaysAgo = daysAgo(7);

    // Query recent unacted-on opportunities
    const { data: opportunities, error: oppErr } = await sb
      .from("mavis_opportunities")
      .select("id, title, description, opportunity_type, domains, potential_value, action_steps")
      .eq("user_id", userId)
      .eq("acted_on", false)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(2);

    if (oppErr) {
      // Table may not exist — skip gracefully
      if (oppErr.code === "42P01" || oppErr.message?.includes("does not exist")) return result;
      return result;
    }
    if (!opportunities || opportunities.length === 0) return result;

    // Fetch active quests for alignment context
    const { data: activeQuests } = await sb
      .from("quests")
      .select("id, title, description, category")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(5);

    // Fetch recent journal entries for context
    let journalContext = "";
    try {
      const { data: journals } = await sb
        .from("journal_entries")
        .select("content, created_at")
        .eq("user_id", userId)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(3);

      if (journals && journals.length > 0) {
        journalContext = (journals as any[])
          .map((j: any) => String(j.content ?? "").slice(0, 200))
          .join(" | ");
      }
    } catch {
      // journal_entries may not exist — ignore
    }

    // Fetch recent notes for context
    let notesContext = "";
    try {
      const { data: notes } = await sb
        .from("mavis_notes")
        .select("title, content")
        .eq("user_id", userId)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(3);

      if (notes && notes.length > 0) {
        notesContext = (notes as any[])
          .map((n: any) => `${n.title}: ${String(n.content ?? "").slice(0, 150)}`)
          .join(" | ");
      }
    } catch {
      // mavis_notes may not exist — ignore
    }

    const questSummary = (activeQuests ?? [])
      .map((q: any) => `"${q.title}" (${q.category || "general"})`)
      .join(", ") || "no active quests";

    for (const opp of opportunities as any[]) {
      try {
        const systemPrompt = `You are Mavis, an elite AI personal operating system.
Analyze an opportunity and connect it to the operator's active quests and recent context.
Respond with a JSON object containing exactly these keys:
- "quest_name": the most relevant active quest name (or "General growth" if none match)
- "why_now": one sentence (under 20 words) explaining why this matters right now
- "next_step": one concrete action (under 15 words) to capitalize on this opportunity

Output ONLY valid JSON, no markdown, no preamble.`;

        const userMsg = `Opportunity: ${opp.title}
Description: ${opp.description}
Type: ${opp.opportunity_type}
Potential value: ${opp.potential_value || "unspecified"}

Active quests: ${questSummary}
Recent journal context: ${journalContext || "none"}
Recent notes context: ${notesContext || "none"}

Connect this opportunity to the most relevant quest and explain why now and the next step.`;

        const rawResponse = await callHaiku(systemPrompt, userMsg, 200);

        let alignment: { quest_name: string; why_now: string; next_step: string } = {
          quest_name: "General growth",
          why_now: "This opportunity aligns with your current momentum.",
          next_step: "Review and decide whether to act on this opportunity.",
        };

        try {
          const parsed = JSON.parse(rawResponse);
          if (parsed.quest_name) alignment.quest_name = String(parsed.quest_name);
          if (parsed.why_now) alignment.why_now = String(parsed.why_now);
          if (parsed.next_step) alignment.next_step = String(parsed.next_step);
        } catch {
          // Keep defaults if JSON parse fails
        }

        const tgMessage = `🎯 *Opportunity Alignment*
${opp.title}

Connects to: ${alignment.quest_name}
Why now: ${alignment.why_now}
Next step: ${alignment.next_step}`;

        await sendTelegram(tgMessage);

        result.issues++;
        result.actions++;
      } catch (oppItemErr) {
        console.error(`[ambient-monitor] Error processing opportunity:`, oppItemErr);
      }
    }

    result.details = { opportunities_linked: result.issues };
  } catch (err) {
    console.error("[ambient-monitor] checkOpportunityLinks error:", err);
  }

  return result;
}

// ── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Service-role only — triggered by pg_cron. verify_jwt is off for this
  // function, so gate here to stop anyone triggering scans / Telegram sends.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer !== SB_KEY) return json({ error: "Unauthorized" }, 401);

  try {
    const sb = createClient(SB_URL, SB_KEY);

    // Fetch all profiles active within the last 7 days.
    // We join via auth.users last_sign_in_at via mavis_memory activity as a proxy
    // since profiles.updated_at is bumped on any profile write.
    const sevenDaysAgo = daysAgo(7);

    // Get distinct user_ids that have had memory activity in the last 7 days
    // (more reliable than profiles.updated_at for detecting real usage)
    const { data: activeRows, error: activeErr } = await sb
      .from("mavis_memory")
      .select("user_id")
      .gte("created_at", sevenDaysAgo)
      .order("user_id");

    if (activeErr) {
      console.error("[ambient-monitor] Failed to fetch active users:", activeErr.message);
      return json({ error: activeErr.message }, 500);
    }

    // Deduplicate user ids
    const userIds: string[] = [
      ...new Set((activeRows ?? []).map((r: any) => String(r.user_id))),
    ];

    if (userIds.length === 0) {
      return json({ processed: 0, issues: 0, message: "No active users found" });
    }

    let totalProcessed = 0;
    let totalIssues = 0;

    for (const userId of userIds) {
      try {
        // Run original 5 checks in parallel
        const [q1, q2, q3, q4, q5] = await Promise.all([
          checkOverdueQuests(sb, userId),
          checkHealthAnomalies(sb, userId),
          checkPriorityEmails(sb, userId),
          checkRevenueMentions(sb, userId),
          checkUpcomingEvents(sb, userId),
        ]);

        // Run the 3 new proactive orchestration checks concurrently.
        // allSettled ensures a failure in one does not block the others.
        const [r6, r7, r8] = await Promise.allSettled([
          checkDormantContacts(sb, userId),
          checkStalledQuests(sb, userId),
          checkOpportunityLinks(sb, userId),
        ]);

        const q6: CheckResult = r6.status === "fulfilled" ? r6.value : { issues: 0, actions: 0, details: {} };
        const q7: CheckResult = r7.status === "fulfilled" ? r7.value : { issues: 0, actions: 0, details: {} };
        const q8: CheckResult = r8.status === "fulfilled" ? r8.value : { issues: 0, actions: 0, details: {} };

        if (r6.status === "rejected") console.error("[ambient-monitor] checkDormantContacts rejected:", r6.reason);
        if (r7.status === "rejected") console.error("[ambient-monitor] checkStalledQuests rejected:", r7.reason);
        if (r8.status === "rejected") console.error("[ambient-monitor] checkOpportunityLinks rejected:", r8.reason);

        const results = [q1, q2, q3, q4, q5, q6, q7, q8];
        const issuesFound = results.reduce((sum, r) => sum + r.issues, 0);
        const actionsTaken = results.reduce((sum, r) => sum + r.actions, 0);

        // Always write an ambient event record so we have an audit trail
        await sb.from("mavis_ambient_events").insert({
          user_id: userId,
          checks_run: 8,
          issues_found: issuesFound,
          actions_taken: actionsTaken,
          details: {
            overdue_quests: q1.details,
            health_anomalies: q2.details,
            priority_emails: q3.details,
            revenue_gap: q4.details,
            upcoming_events: q5.details,
            dormant_contacts: q6.details,
            stalled_quests: q7.details,
            opportunity_links: q8.details,
          },
          created_at: nowIso(),
        });

        // Send push notification if there are any issues
        if (issuesFound > 0) {
          const summaryParts: string[] = [];
          if (q1.issues > 0) summaryParts.push(`${q1.issues} overdue quest(s)`);
          if (q2.issues > 0) summaryParts.push(`health anomaly detected`);
          if (q3.issues > 0) summaryParts.push(`${q3.issues} priority email(s)`);
          if (q4.issues > 0) summaryParts.push(`no revenue review in 7 days`);
          if (q5.issues > 0) summaryParts.push(`${q5.issues} upcoming event(s)`);
          if (q6.issues > 0) summaryParts.push(`${q6.issues} dormant contact(s) to reconnect`);
          if (q7.issues > 0) summaryParts.push(`${q7.issues} stalled quest(s) with recovery plan`);
          if (q8.issues > 0) summaryParts.push(`${q8.issues} opportunity alignment(s) ready`);
          const summary = summaryParts.join(" • ");

          await callEdgeFunction("mavis-push-notify", {
            user_id: userId,
            title: "MAVIS Alert",
            body: summary,
            data: { type: "ambient_monitor", issues: String(issuesFound) },
          });
        }

        totalIssues += issuesFound;
        totalProcessed++;
      } catch (userErr: unknown) {
        const msg = userErr instanceof Error ? userErr.message : String(userErr);
        console.error(`[ambient-monitor] Error processing user ${userId}:`, msg);
        // Continue with next user — don't abort the whole run
      }
    }

    return json({ processed: totalProcessed, issues: totalIssues });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ambient-monitor] Fatal error:", message);
    return json({ error: message }, 500);
  }
});
