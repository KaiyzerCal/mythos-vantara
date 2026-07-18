// mavis-meeting-brief
// Fires every 30 minutes via pg_cron. Checks Google Calendar for meetings
// starting in the next 25–65 minutes, generates a rich attendee brief
// (from contacts table + enrichment + relationship-intel), and sends it
// to Telegram. Deduplicates via mavis_meeting_briefs_sent so each event
// only gets one brief.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OPERATOR_USER_ID = Deno.env.get("TELEGRAM_OPERATOR_USER_ID")!;
const BOT_TOKEN        = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID          = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

async function sendTelegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = text.length > 4096 ? text.slice(0, 4056) + "\n…[truncated]" : text;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: payload, parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function refreshGoogleToken(config: Record<string, unknown>): Promise<string> {
  if (typeof config.expires_at === "number" && config.expires_at > Date.now() / 1000 + 300) {
    return config.access_token as string;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     config.client_id as string,
      client_secret: config.client_secret as string,
      refresh_token: config.refresh_token as string,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Calendar token refresh failed");
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await sb.from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("provider", "google_calendar")
    .eq("user_id", OPERATOR_USER_ID);
  return data.access_token as string;
}

async function generateBrief(
  event: { title: string; start: string; attendees: string[] },
  contactData: any[],
): Promise<string> {
  if (!ANTHROPIC_KEY) {
    // Fallback: plain text brief without AI
    const lines = contactData.map((c: any) => {
      const parts: string[] = [`• *${c.name}*`];
      if (c.company) parts.push(`(${c.company})`);
      if (c.enrichment?.headline) parts.push(`— ${c.enrichment.headline}`);
      if (c.enrichment?.recentPost) parts.push(`\n  Recent: "${c.enrichment.recentPost.slice(0, 120)}"`);
      if (c.notes) parts.push(`\n  Notes: ${c.notes.slice(0, 150)}`);
      if (c.last_contact_at) {
        const daysAgo = Math.round((Date.now() - new Date(c.last_contact_at).getTime()) / 86400000);
        parts.push(`\n  Last contact: ${daysAgo}d ago`);
      }
      return parts.join(" ");
    });
    return lines.join("\n\n");
  }

  const contactContext = contactData.map((c: any) => {
    const enrichment = c.enrichment ?? {};
    return [
      `Name: ${c.name}`,
      c.company ? `Company: ${c.company}` : null,
      c.relationship_type ? `Relationship: ${c.relationship_type}` : null,
      enrichment.headline ? `LinkedIn headline: ${enrichment.headline}` : null,
      enrichment.recentPost ? `Recent post: "${enrichment.recentPost.slice(0, 200)}"` : null,
      enrichment.currentRole ? `Current role: ${enrichment.currentRole}` : null,
      c.notes ? `Notes: ${c.notes.slice(0, 200)}` : null,
      c.last_contact_at
        ? `Last contact: ${Math.round((Date.now() - new Date(c.last_contact_at).getTime()) / 86400000)}d ago`
        : null,
    ].filter(Boolean).join("\n");
  }).join("\n\n---\n\n");

  const unknownAttendees = event.attendees.filter(
    (a) => !contactData.some((c) => c.email === a || c.name?.toLowerCase().includes(a.split("@")[0].toLowerCase()))
  );

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: `You are MAVIS, a sovereign AI personal OS generating a pre-meeting brief.
Be concise, specific, and actionable. Surface relationship context and suggest one strong opener per person.
Format using Telegram markdown (*bold*, _italic_). Keep total under 500 words.`,
      messages: [{
        role: "user",
        content: `Generate a pre-meeting brief for:
Meeting: ${event.title}
Starts: ${new Date(event.start).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}

Known attendee context:
${contactContext || "No CRM data found for attendees."}

${unknownAttendees.length > 0 ? `Unknown attendees: ${unknownAttendees.join(", ")}` : ""}

For each person: relationship context, what they've been up to, one conversation opener.
End with: one thing to watch for in this meeting.`,
      }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const data = await res.json();
  return data.content?.[0]?.text ?? "Brief unavailable — check Anthropic key.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  try {
    if (!OPERATOR_USER_ID) throw new Error("TELEGRAM_OPERATOR_USER_ID not set");
    const uid = OPERATOR_USER_ID;
    const now = new Date();

    // Window: meetings starting 25–65 minutes from now
    const windowStart = new Date(now.getTime() + 25 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + 65 * 60 * 1000);

    // Load Google Calendar OAuth
    const { data: calInt } = await sb
      .from("mavis_user_integrations").select("config")
      .eq("user_id", uid).eq("provider", "google_calendar").maybeSingle();

    if (!calInt?.config) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_calendar_oauth" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = await refreshGoogleToken(calInt.config as Record<string, unknown>);

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
        timeMin:      windowStart.toISOString(),
        timeMax:      windowEnd.toISOString(),
        maxResults:   "10",
        singleEvents: "true",
        orderBy:      "startTime",
      })}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) },
    );

    if (!calRes.ok) {
      return new Response(JSON.stringify({ ok: true, skipped: "calendar_fetch_failed" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const calData = await calRes.json();
    const events  = (calData.items ?? []) as any[];

    let briefsSent = 0;

    for (const event of events) {
      const eventId    = event.id as string;
      const eventTitle = String(event.summary ?? "(No title)");
      const eventStart = String(event.start?.dateTime ?? event.start?.date ?? "");

      // Skip all-day events (no time component)
      if (event.start?.dateTime === undefined) continue;

      // Skip if brief already sent for this event
      const { data: alreadySent } = await sb
        .from("mavis_meeting_briefs_sent")
        .select("id")
        .eq("user_id", uid)
        .eq("event_id", eventId)
        .maybeSingle();
      if (alreadySent) continue;

      // Extract attendee emails
      const attendeeEmails: string[] = (event.attendees ?? [])
        .map((a: any) => a.email as string)
        .filter((e: string) => e && !e.includes("calendar.google.com"));

      // Look up contacts for each attendee
      let contactData: any[] = [];
      if (attendeeEmails.length > 0) {
        const { data: contacts } = await sb
          .from("contacts")
          .select("name, email, company, relationship_type, notes, last_contact_at, enrichment, pipeline_name, pipeline_stage")
          .eq("user_id", uid)
          .in("email", attendeeEmails);
        contactData = contacts ?? [];
      }

      // Also try matching by name from event attendees (displayName)
      const attendeeNames: string[] = (event.attendees ?? [])
        .map((a: any) => a.displayName as string)
        .filter(Boolean);

      if (attendeeNames.length > 0 && contactData.length < attendeeEmails.length) {
        for (const name of attendeeNames) {
          if (!contactData.some((c: any) => c.name?.toLowerCase() === name.toLowerCase())) {
            const { data: byName } = await sb
              .from("contacts")
              .select("name, email, company, relationship_type, notes, last_contact_at, enrichment, pipeline_name, pipeline_stage")
              .eq("user_id", uid)
              .ilike("name", `%${name}%`)
              .limit(1)
              .maybeSingle();
            if (byName) contactData.push(byName);
          }
        }
      }

      // Generate the brief
      const briefBody = await generateBrief({
        title:     eventTitle,
        start:     eventStart,
        attendees: attendeeEmails,
      }, contactData);

      const startTime = new Date(eventStart).toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: true,
      });
      const minutesUntil = Math.round((new Date(eventStart).getTime() - now.getTime()) / 60000);

      const message = [
        `📋 *PRE-MEETING BRIEF*`,
        `*${eventTitle}* — in ${minutesUntil} minutes (${startTime})`,
        `─────────────────────`,
        briefBody,
        `─────────────────────`,
        `_Reply "thread: [note]" to log a loose thread from this meeting_`,
      ].join("\n");

      await sendTelegram(message);

      // Record as sent
      await sb.from("mavis_meeting_briefs_sent").insert({
        user_id:     uid,
        event_id:    eventId,
        event_start: eventStart,
      }).catch(() => {});

      briefsSent++;
    }

    return new Response(
      JSON.stringify({ ok: true, briefsSent, eventsChecked: events.length }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-meeting-brief]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
