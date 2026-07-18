// mavis-post-meeting
// Fires every 20 minutes via pg_cron. Detects calendar events that ended
// in the past 15–45 minutes and auto-drafts a follow-up email for each,
// queueing it in mavis_action_queue (approve tier) and pinging Telegram.
// Also creates a loose_thread for any action items detected.

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

async function refreshGoogleToken(config: Record<string, unknown>, uid: string): Promise<string> {
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
  await sb.from("mavis_user_integrations").update({ config: newConfig })
    .eq("provider", "google_calendar").eq("user_id", uid);
  return data.access_token as string;
}

async function draftFollowUp(
  eventTitle: string,
  attendeeNames: string[],
  contactNotes: string,
): Promise<{ subject: string; body: string; actionItems: string[] }> {
  if (!ANTHROPIC_KEY) {
    return {
      subject: `Following up on: ${eventTitle}`,
      body: `Hi,\n\nGreat connecting today regarding "${eventTitle}". Looking forward to next steps.\n\nBest,\nCalvin`,
      actionItems: [],
    };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: `You are MAVIS drafting a post-meeting follow-up email on behalf of Calvin.
Be warm but professional. Keep it under 150 words. Extract any clear action items.
Respond ONLY with valid JSON: { "subject": "...", "body": "...", "actionItems": ["..."] }`,
      messages: [{
        role: "user",
        content: `Meeting: ${eventTitle}
Attendees: ${attendeeNames.join(", ") || "unknown"}
${contactNotes ? `Context: ${contactNotes}` : ""}

Draft a follow-up email and list any action items you can infer.`,
      }],
    }),
    signal: AbortSignal.timeout(18_000),
  });

  const data = await res.json();
  const text = data.content?.[0]?.text ?? "{}";
  try {
    return JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
  } catch {
    return {
      subject: `Following up on: ${eventTitle}`,
      body: text.slice(0, 600),
      actionItems: [],
    };
  }
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

    // Window: events that ended 15–45 minutes ago
    const windowStart = new Date(now.getTime() - 45 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() - 15 * 60 * 1000);

    const { data: calInt } = await sb
      .from("mavis_user_integrations").select("config")
      .eq("user_id", uid).eq("provider", "google_calendar").maybeSingle();

    if (!calInt?.config) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_calendar_oauth" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = await refreshGoogleToken(calInt.config as Record<string, unknown>, uid);

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

    const calData  = await calRes.json();
    const events   = (calData.items ?? []) as any[];
    let processed  = 0;

    for (const event of events) {
      const eventId    = String(event.id);
      const eventTitle = String(event.summary ?? "(No title)");

      // Skip all-day events
      if (!event.start?.dateTime) continue;

      // Skip if already processed (check loose_threads for this event_ref)
      const { data: alreadyProcessed } = await sb
        .from("loose_threads")
        .select("id")
        .eq("user_id", uid)
        .eq("source_ref", `post-meeting:${eventId}`)
        .maybeSingle();
      if (alreadyProcessed) continue;

      const attendeeEmails: string[] = (event.attendees ?? [])
        .map((a: any) => a.email as string)
        .filter((e: string) => e && !e.includes("calendar.google.com") && !e.includes(uid));

      const attendeeNames: string[] = (event.attendees ?? [])
        .map((a: any) => (a.displayName ?? a.email ?? "") as string)
        .filter((n: string) => n && !n.includes(uid));

      // Fetch contact data for context
      let contactNotes = "";
      if (attendeeEmails.length > 0) {
        const { data: contacts } = await sb
          .from("contacts")
          .select("name, notes, pipeline_name, pipeline_stage, last_contact_at")
          .eq("user_id", uid)
          .in("email", attendeeEmails);

        if (contacts?.length) {
          contactNotes = contacts.map((c: any) =>
            [c.notes, c.pipeline_name ? `Pipeline: ${c.pipeline_name} / ${c.pipeline_stage}` : null]
              .filter(Boolean).join("; ")
          ).join("\n");
        }
      }

      // Draft follow-up
      const draft = await draftFollowUp(eventTitle, attendeeNames, contactNotes);

      // Queue as an approve-tier action (user must approve before sending)
      const toEmail = attendeeEmails[0] ?? "";
      if (toEmail) {
        await sb.from("mavis_action_queue").insert({
          user_id:      uid,
          action_type:  "draft_email",
          autonomy_tier: "approve",
          status:       "pending",
          action_payload: {
            to:      toEmail,
            subject: draft.subject,
            body:    draft.body,
            source:  `post-meeting:${eventId}`,
          },
          description:  `Post-meeting follow-up: ${eventTitle}`,
        }).catch(() => {});
      }

      // Save any inferred action items as loose threads
      for (const item of (draft.actionItems ?? []).slice(0, 3)) {
        await sb.from("loose_threads").insert({
          user_id:    uid,
          title:      item.slice(0, 200),
          source:     "calendar",
          source_ref: `post-meeting:${eventId}`,
          context:    eventTitle,
          status:     "open",
        }).catch(() => {});
      }

      // Mark as processed with a sentinel thread so we skip on next cron tick
      await sb.from("loose_threads").insert({
        user_id:    uid,
        title:      `Follow-up: ${eventTitle}`,
        source:     "calendar",
        source_ref: `post-meeting:${eventId}`,
        context:    eventTitle,
        status:     "open",
      }).catch(() => {});

      // Ping Telegram
      const itemList = draft.actionItems?.length
        ? `\n\n*Action items:*\n${draft.actionItems.map((i: string) => `• ${i}`).join("\n")}`
        : "";

      await sendTelegram(
        `✅ *Post-Meeting: ${eventTitle}*\n\n` +
        `Draft follow-up queued${toEmail ? ` → ${toEmail}` : ""}\n` +
        `_Subject: ${draft.subject}_` +
        itemList +
        `\n\n→ Reply "approve" or check Actions to send`,
      );

      processed++;
    }

    return new Response(
      JSON.stringify({ ok: true, processed, eventsChecked: events.length }),
      { headers: { "Content-Type": "application/json" } },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-post-meeting]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
