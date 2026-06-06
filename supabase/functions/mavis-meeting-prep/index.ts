// mavis-meeting-prep
// Auto-generates a meeting preparation brief 30 minutes before calendar events.
// Sources context from mavis_notes, journal_entries, mavis_tacit, and mavis_relationship_health.
// Sends a Telegram push notification with the prep brief and key talking points.
//
// NOTE: No `mavis_calendar_events` table exists in migrations. The schema uses
// `calendar_events` (public.calendar_events, created in 20260517200000_new_features.sql)
// with columns: id, user_id, event_uid, title, start_at, end_at, description, location.
// Cron mode queries that table for events starting in the next 25-35 minutes.
// Manual trigger mode accepts: { user_id, event_id, event_title, event_start, attendees }.
//
// Modes:
//   POST { cron: true }                                        — fan-out across all users
//   POST { user_id, event_id, event_title, event_start, attendees? } — on-demand single event
//   GET  ?user_id=...                                          — return preps from last 7 days
//
// verify_jwt = false — authenticated by service-role bearer token or cron.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Claude call ────────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string, maxTokens = 800): Promise<string> {
  if (!ANTHROPIC_KEY) return "";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    console.error("[meeting-prep] Claude error:", res.status, await res.text());
    return "";
  }
  const d = await res.json();
  return d.content?.find((b: any) => b.type === "text")?.text ?? "";
}

// ── Telegram ───────────────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
    });
  } catch (err) {
    console.error("[meeting-prep] Telegram send failed:", err);
  }
}

// ── Context gathering ──────────────────────────────────────────────────────────

interface MeetingContext {
  tacit: string;
  relevantNotes: string;
  journalContext: string;
  relationshipIntel: string;
}

async function gatherContext(userId: string, attendees: string[]): Promise<MeetingContext> {
  // Fetch all context in parallel, handling missing tables gracefully
  const [tacitRes, notesRes, journalRes, relRes] = await Promise.all([
    // Operator tacit knowledge: name, role, goals, preferences
    sb
      .from("mavis_tacit")
      .select("key, value, category")
      .eq("user_id", userId)
      .in("category", ["preference", "standing_order", "workflow_habit"])
      .limit(20),

    // Notes mentioning attendee names (ilike search across title + content)
    attendees.length > 0
      ? sb
          .from("mavis_notes")
          .select("title, content")
          .eq("user_id", userId)
          .or(
            attendees
              .map((a) => `title.ilike.%${a}%,content.ilike.%${a}%`)
              .join(","),
          )
          .limit(5)
      : sb
          .from("mavis_notes")
          .select("title, content")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(3),

    // Last 3 journal entries for mood/energy context
    sb
      .from("journal_entries")
      .select("title, content, mood, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(3),

    // Relationship health data for attendees (mavis_relationship_health uses contact_name)
    attendees.length > 0
      ? sb
          .from("mavis_relationship_health")
          .select("contact_name, health_score, interaction_frequency, notes, suggested_action")
          .eq("user_id", userId)
          .or(attendees.map((a) => `contact_name.ilike.%${a}%`).join(","))
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Format tacit knowledge
  const tacitRows = tacitRes.data ?? [];
  const tacit = tacitRows.length > 0
    ? tacitRows.map((t: any) => `${t.key}: ${t.value}`).join("\n")
    : "No operator context available.";

  // Format relevant notes
  const notes = notesRes.data ?? [];
  const relevantNotes = notes.length > 0
    ? notes
        .map((n: any) => `[${n.title}]\n${(n.content ?? "").slice(0, 400)}`)
        .join("\n\n---\n\n")
    : "No relevant notes found.";

  // Format journal context (mood/energy summary)
  const journals = journalRes.data ?? [];
  const journalContext = journals.length > 0
    ? journals
        .map((j: any) => {
          const date = new Date(j.created_at).toLocaleDateString();
          const mood = j.mood ? ` (mood: ${j.mood})` : "";
          return `${date}${mood}: ${(j.content ?? "").slice(0, 200)}`;
        })
        .join("\n")
    : "No recent journal entries.";

  // Format relationship intel
  const relRows = relRes.data ?? [];
  const relationshipIntel = relRows.length > 0
    ? relRows
        .map(
          (r: any) =>
            `${r.contact_name}: health_score=${r.health_score}, frequency=${r.interaction_frequency}` +
            (r.notes ? `, notes: ${r.notes.slice(0, 150)}` : "") +
            (r.suggested_action ? `, suggested: ${r.suggested_action}` : ""),
        )
        .join("\n")
    : "No relationship data for attendees.";

  return { tacit, relevantNotes, journalContext, relationshipIntel };
}

// ── Meeting prep generation ────────────────────────────────────────────────────

interface PrepResult {
  prep_brief: string;
  talking_points: string[];
  context_notes: string;
}

async function generatePrep(
  eventTitle: string,
  eventStart: string,
  attendees: string[],
  ctx: MeetingContext,
): Promise<PrepResult> {
  const eventTime = new Date(eventStart).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const attendeeStr = attendees.length > 0 ? attendees.join(", ") : "No attendees listed";

  const systemPrompt = `You are Mavis, an elite personal AI operating system. Generate a concise, sharp meeting prep brief. No fluff. Be direct, actionable, and specific. Format your response as valid JSON.`;

  const userPrompt = `Meeting: ${eventTitle}
Time: ${eventTime}
Attendees: ${attendeeStr}

Operator context:
${ctx.tacit}

Recent journal / energy:
${ctx.journalContext}

Relevant notes:
${ctx.relevantNotes}

Relationship intel:
${ctx.relationshipIntel}

Generate a meeting prep brief as JSON with this exact shape:
{
  "objective": "one sentence meeting objective",
  "talking_points": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "questions": ["question 1", "question 2", "question 3"],
  "watch_for": ["thing 1", "thing 2"],
  "desired_outcome": "one sentence desired outcome",
  "brief_summary": "2-3 sentence narrative summary combining all of the above"
}

Keep it sharp and actionable. Max 5 talking points, 3 questions, 2 watch-fors.`;

  const raw = await callClaude(systemPrompt, userPrompt, 900);

  // Parse Claude's JSON response
  let parsed: any = null;
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // If JSON parse fails, use the raw text as the brief
    console.warn("[meeting-prep] Could not parse Claude JSON — using raw text as brief");
  }

  const talkingPoints: string[] = parsed?.talking_points ?? [];
  const questions: string[] = parsed?.questions ?? [];
  const watchFor: string[] = parsed?.watch_for ?? [];

  let prepBrief: string;
  if (parsed?.brief_summary) {
    prepBrief = [
      parsed.brief_summary,
      "",
      parsed.objective ? `Objective: ${parsed.objective}` : "",
      questions.length > 0 ? `\nKey questions: ${questions.join(" | ")}` : "",
      watchFor.length > 0 ? `Watch for: ${watchFor.join(" | ")}` : "",
      parsed.desired_outcome ? `\nDesired outcome: ${parsed.desired_outcome}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim();
  } else {
    prepBrief = raw.slice(0, 1000) || "Prep brief unavailable — no AI key configured.";
  }

  const contextNotes = `Notes searched: ${ctx.relevantNotes.slice(0, 300)}`;

  return { prep_brief: prepBrief, talking_points: talkingPoints, context_notes: contextNotes };
}

// ── Telegram notification ──────────────────────────────────────────────────────

function buildTelegramMessage(
  eventTitle: string,
  eventStart: string,
  prepBrief: string,
  talkingPoints: string[],
): string {
  const timeStr = new Date(eventStart).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const briefSnippet = prepBrief.slice(0, 500) + (prepBrief.length > 500 ? "…" : "");
  const topPoints = talkingPoints.slice(0, 3);

  const lines = [
    `\u{1F5D3} *Meeting Prep Ready*`,
    `*${eventTitle}* — in 30 min (${timeStr})`,
    ``,
    `\u{1F4CB} *Brief:*`,
    briefSnippet,
  ];

  if (topPoints.length > 0) {
    lines.push(``, `\u{1F4AC} *Key Points:*`);
    topPoints.forEach((p) => lines.push(`• ${p}`));
  }

  return lines.join("\n");
}

// ── Process a single event ─────────────────────────────────────────────────────

async function processEvent(
  userId: string,
  eventId: string,
  eventTitle: string,
  eventStart: string,
  attendees: string[],
): Promise<{ ok: boolean; event_id: string; error?: string }> {
  try {
    // Skip if prep already exists
    const { data: existing } = await sb
      .from("mavis_meeting_preps")
      .select("id, prep_sent")
      .eq("user_id", userId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (existing?.prep_sent) {
      return { ok: true, event_id: eventId };
    }

    // Gather context
    const ctx = await gatherContext(userId, attendees);

    // Generate prep
    const { prep_brief, talking_points, context_notes } = await generatePrep(
      eventTitle,
      eventStart,
      attendees,
      ctx,
    );

    // Store in DB
    const { error: upsertErr } = await sb.from("mavis_meeting_preps").upsert(
      {
        user_id: userId,
        event_id: eventId,
        event_title: eventTitle,
        event_start: eventStart,
        attendees,
        prep_brief,
        talking_points,
        context_notes,
        prep_sent: false,
      },
      { onConflict: "user_id,event_id" },
    );

    if (upsertErr) throw new Error(upsertErr.message);

    // Send Telegram notification
    const telegramMsg = buildTelegramMessage(eventTitle, eventStart, prep_brief, talking_points);
    await sendTelegram(telegramMsg);

    // Mark prep_sent = true
    await sb
      .from("mavis_meeting_preps")
      .update({ prep_sent: true })
      .eq("user_id", userId)
      .eq("event_id", eventId);

    return { ok: true, event_id: eventId };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[meeting-prep] processEvent failed for event ${eventId}:`, msg);
    return { ok: false, event_id: eventId, error: msg };
  }
}

// ── Cron fan-out: find upcoming events across all users ────────────────────────

async function cronRun(): Promise<{ processed: number; skipped: number; errors: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 25 * 60 * 1000).toISOString(); // +25 min
  const windowEnd = new Date(now.getTime() + 35 * 60 * 1000).toISOString();   // +35 min

  let processed = 0, skipped = 0, errors = 0;

  // Query public.calendar_events (created in 20260517200000_new_features.sql)
  // Columns: id, user_id, event_uid, title, start_at, end_at, description, location
  let calendarRows: any[] = [];
  try {
    const { data, error } = await sb
      .from("calendar_events")
      .select("id, user_id, event_uid, title, start_at, description")
      .gte("start_at", windowStart)
      .lte("start_at", windowEnd);

    if (error) {
      // Table may not exist or be empty — that's fine, fall through
      console.warn("[meeting-prep] calendar_events query failed:", error.message);
    } else {
      calendarRows = data ?? [];
    }
  } catch (err) {
    console.warn("[meeting-prep] calendar_events unavailable:", err);
  }

  for (const row of calendarRows) {
    // Skip if prep already sent
    const { data: existing } = await sb
      .from("mavis_meeting_preps")
      .select("id, prep_sent")
      .eq("user_id", row.user_id)
      .eq("event_id", row.event_uid ?? row.id)
      .maybeSingle();

    if (existing?.prep_sent) {
      skipped++;
      continue;
    }

    // Extract attendees from description if available (best-effort parse)
    const attendees: string[] = [];
    if (row.description) {
      const match = row.description.match(/attendees?[:\s]+([^\n]+)/i);
      if (match) {
        attendees.push(...match[1].split(/[,;]/).map((s: string) => s.trim()).filter(Boolean));
      }
    }

    const result = await processEvent(
      row.user_id,
      row.event_uid ?? String(row.id),
      row.title,
      row.start_at,
      attendees,
    );

    result.ok ? processed++ : errors++;
  }

  return { processed, skipped, errors };
}

// ── Main handler ───────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Auth check — accept service-role key as bearer token
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token !== SB_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── GET: recent preps for a user ──────────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "user_id required" }, 400);

      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error } = await sb
        .from("mavis_meeting_preps")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("event_start", { ascending: true });

      if (error) return json({ error: error.message }, 500);
      return json({ preps: data ?? [] });
    }

    // ── POST ──────────────────────────────────────────────────────────────
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));

    // Cron mode: fan-out across all users with upcoming calendar events
    if (body.cron === true) {
      const result = await cronRun();
      return json({ mode: "cron", ...result });
    }

    // On-demand mode: single event
    const userId = String(body.user_id ?? "").trim();
    const eventId = String(body.event_id ?? "").trim();
    const eventTitle = String(body.event_title ?? "").trim();
    const eventStart = String(body.event_start ?? "").trim();
    const attendees: string[] = Array.isArray(body.attendees) ? body.attendees : [];

    if (!userId) return json({ error: "user_id required" }, 400);
    if (!eventTitle) return json({ error: "event_title required" }, 400);
    if (!eventStart) return json({ error: "event_start required" }, 400);

    // Generate a stable event_id if not provided
    const resolvedEventId = eventId || `manual-${userId}-${Date.now()}`;

    const result = await processEvent(userId, resolvedEventId, eventTitle, eventStart, attendees);

    if (!result.ok) return json({ error: result.error }, 500);

    // Return the stored prep
    const { data: prep } = await sb
      .from("mavis_meeting_preps")
      .select("*")
      .eq("user_id", userId)
      .eq("event_id", resolvedEventId)
      .maybeSingle();

    return json({ mode: "on_demand", prep });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meeting-prep]", msg);
    return json({ error: msg }, 500);
  }
});
