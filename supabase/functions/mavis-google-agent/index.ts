// mavis-google-agent
// Unified Google API agent for MAVIS — Calendar, Gmail, Drive.
// Accepts both JWT auth (from browser) and service-role + userId in body
// (for internal function-to-function calls from mavis-actions / task-executor).
//
// Actions:
//   Calendar: create_calendar_event | update_calendar_event | delete_calendar_event
//             list_calendar_events | find_free_time | create_meet_link
//   Gmail:    send_email | list_emails | search_emails | get_email
//             create_draft | dual_draft | watch_new_emails | mark_read | triage_inbox | smart_triage
//   Drive:    list_files | upload_text | create_folder

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL       = Deno.env.get("SUPABASE_URL")!;
const SB_SRK       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GC_API       = "https://www.googleapis.com/calendar/v3";
const GMAIL_API    = "https://www.googleapis.com/gmail/v1";
const DRIVE_API    = "https://www.googleapis.com/drive/v3";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// ── Token management ─────────────────────────────────────────────────────────

async function refreshGoogleToken(config: any, sb: any, uid: string, provider: string): Promise<string> {
  // Return early if token is still valid for >5 min
  if (config.expires_at && config.expires_at > Date.now() / 1000 + 300) {
    return config.access_token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type:    "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data).slice(0, 200));
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await sb.from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", uid)
    .eq("provider", provider);
  return data.access_token;
}

async function getToken(sb: any, uid: string, provider: string): Promise<string> {
  const { data: integration } = await sb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", uid)
    .eq("provider", provider)
    .single();
  if (!integration?.config) {
    throw new Error(`Google ${provider} not connected. Go to Integrations to connect it.`);
  }
  return refreshGoogleToken(integration.config, sb, uid, provider);
}

// ── Generic Google API request ────────────────────────────────────────────────

async function gReq(token: string, url: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API ${res.status}: ${err.slice(0, 300)}`);
  }
  return method === "DELETE" ? { deleted: true } : res.json();
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toDateTime(dateStr: string, timeStr?: string, tz = "America/New_York"): { dateTime: string; timeZone: string } {
  const dt = timeStr ? new Date(`${dateStr}T${timeStr}`) : new Date(dateStr);
  return { dateTime: dt.toISOString(), timeZone: tz };
}

function toDate(dateStr: string): { date: string } {
  return { date: dateStr };
}

// ── CALENDAR actions ──────────────────────────────────────────────────────────

async function handleCalendar(action: string, p: any, token: string, sb: any, uid: string): Promise<any> {
  const calId = encodeURIComponent(String(p.calendar_id ?? "primary"));
  const tz    = String(p.timezone ?? "America/New_York");

  switch (action) {
    case "list_calendar_events": {
      const timeMin = p.time_min ? new Date(p.time_min).toISOString() : new Date().toISOString();
      const timeMax = p.time_max
        ? new Date(p.time_max).toISOString()
        : new Date(Date.now() + 7 * 86_400_000).toISOString();
      const max = Math.min(Number(p.max_results ?? 20), 50);
      return gReq(token,
        `${GC_API}/calendars/${calId}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${max}&singleEvents=true&orderBy=startTime`
      );
    }

    case "find_free_time": {
      const durationMin = Number(p.duration_minutes ?? 60);
      const startDate   = p.start_date ? new Date(p.start_date) : new Date();
      const endDate     = p.end_date   ? new Date(p.end_date)   : new Date(Date.now() + 3 * 86_400_000);
      const workStart   = Number(p.work_start ?? 9);
      const workEnd     = Number(p.work_end ?? 18);

      const freeBusy = await gReq(token, `${GC_API}/freeBusy`, "POST", {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        items:   [{ id: "primary" }],
      });

      const busy = ((freeBusy.calendars?.primary?.busy ?? []) as { start: string; end: string }[])
        .map(b => ({ start: new Date(b.start), end: new Date(b.end) }));

      const freeSlots: { start: string; end: string }[] = [];
      let cursor = new Date(startDate);
      cursor.setHours(workStart, 0, 0, 0);

      while (cursor < endDate && freeSlots.length < 5) {
        if (cursor.getHours() >= workEnd) {
          cursor.setDate(cursor.getDate() + 1);
          cursor.setHours(workStart, 0, 0, 0);
          continue;
        }
        const slotEnd = new Date(cursor.getTime() + durationMin * 60_000);
        const conflict = busy.some(b => cursor < b.end && slotEnd > b.start);
        if (!conflict && slotEnd.getHours() <= workEnd) {
          freeSlots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
          cursor = slotEnd;
        } else {
          cursor = new Date(cursor.getTime() + 15 * 60_000);
        }
      }
      return { free_slots: freeSlots, duration_minutes: durationMin };
    }

    case "create_calendar_event": {
      const startDate = String(p.start_date ?? p.start_at?.split("T")[0] ?? new Date().toISOString().split("T")[0]);
      const startTime = p.start_time ?? p.start_at?.split("T")[1]?.replace("Z", "");
      const endDate   = String(p.end_date ?? p.end_at?.split("T")[0] ?? startDate);
      const endTime   = p.end_time   ?? p.end_at?.split("T")[1]?.replace("Z", "") ?? "10:00:00";

      const event: Record<string, any> = {
        summary:     String(p.title ?? p.summary ?? "MAVIS Event"),
        description: p.description ? String(p.description) : undefined,
        location:    p.location    ? String(p.location)    : undefined,
        start:       p.all_day ? toDate(startDate) : toDateTime(startDate, startTime, tz),
        end:         p.all_day ? toDate(endDate)   : toDateTime(endDate,   endTime,   tz),
        attendees:   p.attendees ? (p.attendees as string[]).map(e => ({ email: e })) : undefined,
      };

      // Add conferenceData if Meet link requested
      if (p.create_meet) {
        event.conferenceData = { createRequest: { requestId: `mavis-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
      }

      const params = p.create_meet ? `?conferenceDataVersion=1` : "";
      const result = await gReq(token, `${GC_API}/calendars/${calId}/events${params}`, "POST", event);

      // Log to MAVIS memory
      await sb.from("mavis_memory").insert({
        user_id:          uid,
        role:             "assistant",
        content:          `[GOOGLE CALENDAR] Created "${event.summary}" on ${startDate}${event.location ? ` at ${event.location}` : ""}${result.hangoutLink ? ` — Meet: ${result.hangoutLink}` : ""}`,
        importance_score: 6,
        tags:             ["calendar", "google_calendar", "event_created"],
      }).catch(() => {});

      return result;
    }

    case "update_calendar_event": {
      const eventId = String(p.event_id ?? p.google_event_id ?? "");
      if (!eventId) throw new Error("event_id required for update_calendar_event");

      const existing = await gReq(token, `${GC_API}/calendars/${calId}/events/${eventId}`);
      const updates: Record<string, any> = { ...existing };
      if (p.title   ?? p.summary)    updates.summary     = String(p.title ?? p.summary);
      if (p.description !== undefined) updates.description = String(p.description);
      if (p.location !== undefined)    updates.location    = String(p.location);
      if (p.start_date) {
        updates.start = p.all_day
          ? toDate(String(p.start_date))
          : toDateTime(String(p.start_date), p.start_time, tz);
      }
      if (p.end_date) {
        updates.end = p.all_day
          ? toDate(String(p.end_date))
          : toDateTime(String(p.end_date), p.end_time, tz);
      }
      return gReq(token, `${GC_API}/calendars/${calId}/events/${eventId}`, "PUT", updates);
    }

    case "delete_calendar_event": {
      const eventId = String(p.event_id ?? p.google_event_id ?? "");
      if (!eventId) throw new Error("event_id required for delete_calendar_event");
      return gReq(token, `${GC_API}/calendars/${calId}/events/${eventId}`, "DELETE");
    }

    case "create_meet_link": {
      const title     = String(p.title ?? "MAVIS Meeting");
      const startDate = String(p.start_date ?? new Date().toISOString().split("T")[0]);
      const startTime = String(p.start_time ?? "09:00:00");
      const endTime   = String(p.end_time   ?? "10:00:00");

      const event = {
        summary:        title,
        description:    p.description ? String(p.description) : undefined,
        start:          toDateTime(startDate, startTime, tz),
        end:            toDateTime(startDate, endTime,   tz),
        attendees:      p.attendees ? (p.attendees as string[]).map(e => ({ email: e })) : undefined,
        conferenceData: { createRequest: { requestId: `mavis-meet-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      };

      const result = await gReq(token, `${GC_API}/calendars/primary/events?conferenceDataVersion=1`, "POST", event);
      return {
        event_id:    result.id,
        meet_link:   result.hangoutLink ?? result.conferenceData?.entryPoints?.[0]?.uri,
        html_link:   result.htmlLink,
        summary:     result.summary,
        start:       result.start,
        end:         result.end,
      };
    }

    default:
      throw new Error(`Unknown calendar action: ${action}`);
  }
}

// ── GMAIL actions ─────────────────────────────────────────────────────────────

function encodeMime(
  to: string,
  subject: string,
  body: string,
  opts: { from?: string; threadId?: string; inReplyTo?: string; references?: string; htmlBody?: string } = {},
): string {
  const boundary = `boundary_${Date.now()}`;
  const lines = [
    `From: ${opts.from ?? "me"}`,
    `To: ${to}`,
    `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
  ];
  if (opts.inReplyTo)  lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push(
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    btoa(unescape(encodeURIComponent(body))),
  );
  if (opts.htmlBody) {
    lines.push(
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      btoa(unescape(encodeURIComponent(opts.htmlBody))),
    );
  }
  lines.push(`--${boundary}--`);
  const mime = lines.join("\r\n");
  return btoa(unescape(encodeURIComponent(mime))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a Gmail message payload into plain text, walking multipart trees */
function decodeMessageBody(payload: any): string {
  if (!payload) return "";

  const decode = (data: string) => {
    try {
      return decodeURIComponent(escape(atob(data.replace(/-/g, "+").replace(/_/g, "/"))));
    } catch { return ""; }
  };

  if (payload.body?.data) return decode(payload.body.data);

  const parts: any[] = payload.parts ?? [];
  // Prefer text/plain, fall back to text/html
  const plain = parts.find((p: any) => p.mimeType === "text/plain");
  if (plain?.body?.data) return decode(plain.body.data);
  const html = parts.find((p: any) => p.mimeType === "text/html");
  if (html?.body?.data) return decode(html.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  // Recurse into nested multipart
  for (const part of parts) {
    const sub = decodeMessageBody(part);
    if (sub) return sub;
  }
  return "";
}

/** Call Claude to assess or generate text (uses project's ANTHROPIC_API_KEY) */
async function callClaude(systemPrompt: string, userMessage: string, model = "claude-haiku-4-5-20251001", maxTokens = 512): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
  return data.content?.[0]?.text ?? "";
}

async function handleGmail(action: string, p: any, token: string, uid?: string, sb?: any): Promise<any> {
  switch (action) {
    case "send_email": {
      const to      = String(p.to ?? "");
      const subject = String(p.subject ?? "");
      const body    = String(p.body ?? p.content ?? "");
      if (!to || !subject) throw new Error("send_email requires 'to' and 'subject'");

      const raw = encodeMime(to, subject, body, { threadId: p.thread_id });
      const res = await gReq(token, `${GMAIL_API}/users/me/messages/send`, "POST", {
        raw,
        ...(p.thread_id ? { threadId: p.thread_id } : {}),
      });
      return { message_id: res.id, thread_id: res.threadId, label_ids: res.labelIds };
    }

    case "create_draft": {
      const to        = String(p.to ?? "");
      const subject   = String(p.subject ?? "");
      const body      = String(p.body ?? p.content ?? "");
      const threadId  = p.thread_id  ? String(p.thread_id)  : undefined;
      const inReplyTo = p.message_id ? `<${String(p.message_id)}>` : undefined;
      if (!to) throw new Error("create_draft requires 'to'");

      const raw = encodeMime(to, subject, body, { threadId, inReplyTo, references: inReplyTo });
      const res = await gReq(token, `${GMAIL_API}/users/me/drafts`, "POST", {
        message: { raw, ...(threadId ? { threadId } : {}) },
      });
      return { draft_id: res.id, thread_id: res.message?.threadId, message_id: res.message?.id };
    }

    case "get_email": {
      const msgId = String(p.message_id ?? p.id ?? "");
      if (!msgId) throw new Error("get_email requires 'message_id'");
      const msg     = await gReq(token, `${GMAIL_API}/users/me/messages/${msgId}?format=full`);
      const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
      const h = (name: string) => headers.find((hh: any) => hh.name === name)?.value ?? "";
      return {
        id:         msg.id,
        thread_id:  msg.threadId,
        from:       h("From"),
        to:         h("To"),
        subject:    h("Subject"),
        date:       h("Date"),
        message_id: h("Message-ID"),
        references: h("References"),
        body:       decodeMessageBody(msg.payload),
        snippet:    msg.snippet,
        labels:     msg.labelIds ?? [],
      };
    }

    case "mark_read": {
      const msgId = String(p.message_id ?? p.id ?? "");
      if (!msgId) throw new Error("mark_read requires 'message_id'");
      await gReq(token, `${GMAIL_API}/users/me/messages/${msgId}/modify`, "POST", {
        removeLabelIds: ["UNREAD"],
      });
      return { marked_read: true, message_id: msgId };
    }

    case "triage_inbox": {
      // Full auto-responder pipeline: list unread → assess → draft replies
      const limit         = Math.min(Number(p.limit ?? 10), 25);
      const draftReplies  = p.draft_replies !== false;  // default true
      const markRead      = Boolean(p.mark_read ?? false);
      const tone          = String(p.tone ?? "professional");
      const signature     = p.signature ? String(p.signature) : "";
      const customPrompt  = p.system_prompt ? String(p.system_prompt) : "";

      // 1. Fetch unread emails not from self
      const listRes = await gReq(token, `${GMAIL_API}/users/me/messages?maxResults=${limit}&q=is:unread+-from:me+-category:promotions+-category:social`);
      const msgIds: string[] = (listRes.messages ?? []).map((m: any) => m.id);

      if (msgIds.length === 0) return { triaged: 0, drafts_created: 0, results: [] };

      const assessSystem = `You are an email triage assistant. Assess whether an email requires a personal reply.
Return ONLY valid JSON: {"needsReply": true|false, "reason": "...", "urgency": "high|medium|low"}
Marketing emails, newsletters, automated notifications, and no-reply senders → needsReply: false.
Direct questions, requests, meeting invites, client messages → needsReply: true.`;

      const replySystem = customPrompt || `You are MAVIS, a sharp personal AI assistant drafting email replies on behalf of the operator.
Draft a clear, ${tone} reply. Rules:
- Start with "Hello," and end with "Best,"${signature ? `\n${signature}` : ""}
- Address the email's specific question or request directly
- For yes/no questions: provide two options separated by "- - - OR - - -"
- Use [PLACEHOLDER] for anything you cannot know (dates, prices, specific details)
- Plain text only, no markdown formatting
- Match the language of the incoming email
- Be concise — 3-5 sentences unless the topic demands more`;

      const results: any[] = [];
      let draftsCreated = 0;

      for (const msgId of msgIds) {
        try {
          // Get full message
          const msg     = await gReq(token, `${GMAIL_API}/users/me/messages/${msgId}?format=full`);
          const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
          const h = (name: string) => headers.find((hh: any) => hh.name === name)?.value ?? "";
          const from      = h("From");
          const subject   = h("Subject");
          const messageId = h("Message-ID");
          const body      = decodeMessageBody(msg.payload) || msg.snippet;

          // 2. Assess
          const assessInput = `From: ${from}\nSubject: ${subject}\n\nBody:\n${body.slice(0, 2000)}`;
          const assessRaw   = await callClaude(assessSystem, assessInput, "claude-haiku-4-5-20251001", 256);
          const match       = assessRaw.match(/\{[\s\S]*\}/);
          const assessment  = match ? JSON.parse(match[0]) : { needsReply: false, reason: "parse error" };

          const result: any = {
            message_id: msgId,
            thread_id:  msg.threadId,
            from,
            subject,
            needs_reply:  assessment.needsReply,
            reason:       assessment.reason,
            urgency:      assessment.urgency ?? "medium",
            draft_id:     null,
          };

          // 3. Draft reply if needed
          if (assessment.needsReply && draftReplies) {
            const replyText = await callClaude(
              replySystem,
              `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 3000)}`,
              "claude-sonnet-4-6",
              1024,
            );

            // Extract "To" address — strip display name
            const toAddr = from.match(/<([^>]+)>/) ? from.match(/<([^>]+)>/)![1] : from;
            const draft = await gReq(token, `${GMAIL_API}/users/me/drafts`, "POST", {
              message: {
                raw: encodeMime(toAddr, `Re: ${subject}`, replyText, {
                  threadId:   msg.threadId,
                  inReplyTo:  messageId ? `<${messageId}>` : undefined,
                  references: messageId ? `<${messageId}>` : undefined,
                }),
                threadId: msg.threadId,
              },
            });
            result.draft_id     = draft.id;
            result.draft_preview = replyText.slice(0, 200);
            draftsCreated++;
          }

          // 4. Optionally mark as read
          if (markRead) {
            await gReq(token, `${GMAIL_API}/users/me/messages/${msgId}/modify`, "POST", {
              removeLabelIds: ["UNREAD"],
            }).catch(() => {});
          }

          results.push(result);
        } catch (e: unknown) {
          results.push({ message_id: msgId, error: e instanceof Error ? e.message : String(e) });
        }
      }

      return {
        triaged:        results.length,
        drafts_created: draftsCreated,
        skipped:        results.filter(r => !r.needs_reply).length,
        results,
      };
    }

    case "dual_draft": {
      // Run two Claude drafts in parallel (concise + detailed) and combine into one Gmail draft.
      // Mirrors the Make.com dual-model pattern: two AI passes → single combined draft.
      const msgId = String(p.message_id ?? p.id ?? "");
      if (!msgId) throw new Error("dual_draft requires 'message_id'");

      const msg     = await gReq(token, `${GMAIL_API}/users/me/messages/${msgId}?format=full`);
      const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
      const h = (name: string) => headers.find((hh: any) => hh.name === name)?.value ?? "";
      const from      = h("From");
      const subject   = h("Subject");
      const messageId = h("Message-ID");
      const body      = decodeMessageBody(msg.payload) || msg.snippet;
      const toAddr    = from.match(/<([^>]+)>/) ? from.match(/<([^>]+)>/)![1] : from;
      const signature = p.signature ? String(p.signature) : "";

      const systemA = p.prompt_a ? String(p.prompt_a) :
        `Draft a concise, direct email reply in 2-3 sentences. Be professional and to the point.
Start with "Hello," and end with "Best,${signature ? `\n${signature}` : ""}".
Plain text only. Address the core request immediately.`;

      const systemB = p.prompt_b ? String(p.prompt_b) :
        `Draft a thorough, warm email reply that addresses every point raised.
Start with "Hello," and end with "Best,${signature ? `\n${signature}` : ""}".
Plain text only. Use [PLACEHOLDER] for unknown specifics (dates, prices, etc.).
3–6 sentences, comprehensive but not verbose.`;

      const modelA = String(p.model_a ?? "claude-haiku-4-5-20251001");
      const modelB = String(p.model_b ?? "claude-sonnet-4-6");
      const ctx    = `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 3000)}`;

      const [draftA, draftB] = await Promise.all([
        callClaude(systemA, ctx, modelA as any, 512),
        callClaude(systemB, ctx, modelB as any, 1024),
      ]);

      const combined = `--- DRAFT A (Concise) ---\n${draftA}\n\n--- DRAFT B (Detailed) ---\n${draftB}`;

      const draft = await gReq(token, `${GMAIL_API}/users/me/drafts`, "POST", {
        message: {
          raw: encodeMime(toAddr, `Re: ${subject}`, combined, {
            threadId:   msg.threadId,
            inReplyTo:  messageId ? `<${messageId}>` : undefined,
            references: messageId ? `<${messageId}>` : undefined,
          }),
          threadId: msg.threadId,
        },
      });

      return {
        draft_id:       draft.id,
        from,
        subject,
        thread_id:      msg.threadId,
        draft_a_model:  modelA,
        draft_b_model:  modelB,
        draft_a:        draftA,
        draft_b:        draftB,
        draft_preview_a: draftA.slice(0, 150),
        draft_preview_b: draftB.slice(0, 150),
      };
    }

    case "list_emails": {
      const max   = Math.min(Number(p.max_results ?? 10), 50);
      const query = p.query ? `&q=${encodeURIComponent(String(p.query))}` : "";
      const list  = await gReq(token, `${GMAIL_API}/users/me/messages?maxResults=${max}${query}`);
      const ids   = (list.messages ?? []) as { id: string }[];

      const emails = await Promise.all(
        ids.slice(0, 10).map(async ({ id }) => {
          const msg = await gReq(token, `${GMAIL_API}/users/me/messages/${id}?format=metadata&metadataHeaders=From,Subject,Date`);
          const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
          const h = (name: string) => headers.find(h => h.name === name)?.value ?? "";
          return { id, from: h("From"), subject: h("Subject"), date: h("Date"), snippet: msg.snippet };
        })
      );
      return { emails, result_size_estimate: list.resultSizeEstimate };
    }

    case "search_emails": {
      const query = String(p.query ?? "");
      if (!query) throw new Error("search_emails requires 'query'");
      const max  = Math.min(Number(p.max_results ?? 10), 20);
      const list = await gReq(token, `${GMAIL_API}/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`);
      const ids  = (list.messages ?? []) as { id: string }[];

      const emails = await Promise.all(
        ids.slice(0, 10).map(async ({ id }) => {
          const msg = await gReq(token, `${GMAIL_API}/users/me/messages/${id}?format=metadata&metadataHeaders=From,To,Subject,Date`);
          const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
          const h = (name: string) => headers.find(h => h.name === name)?.value ?? "";
          return { id, thread_id: msg.threadId, from: h("From"), to: h("To"), subject: h("Subject"), date: h("Date"), snippet: msg.snippet };
        })
      );
      return { emails, query };
    }

    case "watch_new_emails": {
      // Poll for new unread emails since last check, create dual AI drafts for each.
      // Mirrors Make.com "new email → dual AI draft" trigger scenario.
      if (!sb) throw new Error("watch_new_emails requires internal Supabase client");

      const max       = Math.min(Number(p.max_results ?? 5), 20);
      const modelA    = String(p.model_a ?? "claude-haiku-4-5-20251001");
      const modelB    = String(p.model_b ?? "claude-sonnet-4-6");
      const signature = p.signature ? String(p.signature) : "";
      const stateKey  = String(p.state_key ?? "email_watch_state");

      // Load last_check timestamp from mavis_memory
      const { data: stateRow } = await sb
        .from("mavis_memory")
        .select("id, content")
        .eq("user_id", uid)
        .contains("tags", [stateKey])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastCheckEpoch: number = stateRow
        ? (JSON.parse(stateRow.content)?.last_check_epoch ?? 0)
        : 0;

      const afterFilter = lastCheckEpoch > 0 ? ` after:${lastCheckEpoch}` : "";
      const q = encodeURIComponent(
        `is:unread -from:me -category:promotions -category:social${afterFilter}`
      );
      const listRes = await gReq(token, `${GMAIL_API}/users/me/messages?maxResults=${max}&q=${q}`);
      const msgIds: string[] = (listRes.messages ?? []).map((m: any) => m.id);

      const nowEpoch  = Math.floor(Date.now() / 1000);
      const results: any[] = [];
      let draftsCreated = 0;

      for (const msgId of msgIds) {
        try {
          const msg     = await gReq(token, `${GMAIL_API}/users/me/messages/${msgId}?format=full`);
          const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
          const h = (name: string) => headers.find((hh: any) => hh.name === name)?.value ?? "";
          const from      = h("From");
          const subject   = h("Subject");
          const messageId = h("Message-ID");
          const body      = decodeMessageBody(msg.payload) || msg.snippet;
          const toAddr    = from.match(/<([^>]+)>/) ? from.match(/<([^>]+)>/)![1] : from;
          const ctx       = `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 3000)}`;

          const sysA = p.prompt_a ? String(p.prompt_a) :
            `Draft a concise, direct email reply in 2-3 sentences. Be professional and to the point.
Start with "Hello," and end with "Best,${signature ? `\n${signature}` : ""}".
Plain text only. Address the core request immediately.`;

          const sysB = p.prompt_b ? String(p.prompt_b) :
            `Draft a thorough, warm email reply that addresses every point raised.
Start with "Hello," and end with "Best,${signature ? `\n${signature}` : ""}".
Plain text only. Use [PLACEHOLDER] for unknown specifics.
3–6 sentences, comprehensive but not verbose.`;

          const [draftA, draftB] = await Promise.all([
            callClaude(sysA, ctx, modelA as any, 512),
            callClaude(sysB, ctx, modelB as any, 1024),
          ]);

          const combined = `--- DRAFT A (Concise) ---\n${draftA}\n\n--- DRAFT B (Detailed) ---\n${draftB}`;

          const draft = await gReq(token, `${GMAIL_API}/users/me/drafts`, "POST", {
            message: {
              raw: encodeMime(toAddr, `Re: ${subject}`, combined, {
                threadId:   msg.threadId,
                inReplyTo:  messageId ? `<${messageId}>` : undefined,
                references: messageId ? `<${messageId}>` : undefined,
              }),
              threadId: msg.threadId,
            },
          });

          results.push({
            message_id:    msgId,
            from,
            subject,
            draft_id:      draft.id,
            draft_preview_a: draftA.slice(0, 150),
            draft_preview_b: draftB.slice(0, 150),
          });
          draftsCreated++;
        } catch (e: unknown) {
          results.push({ message_id: msgId, error: e instanceof Error ? e.message : String(e) });
        }
      }

      // Persist updated check timestamp
      const newState = JSON.stringify({
        last_check_epoch: nowEpoch,
        last_run: new Date().toISOString(),
      });
      if (stateRow) {
        await sb.from("mavis_memory").update({ content: newState }).eq("id", stateRow.id);
      } else {
        await sb.from("mavis_memory").insert({
          user_id:    uid,
          role:       "assistant",
          content:    newState,
          tags:       [stateKey, "email_watch", "system_state"],
          importance: 3,
        });
      }

      return { processed: msgIds.length, drafts_created: draftsCreated, results };
    }

    case "smart_triage": {
      // Classify email → lookup category-specific prompt from Sheets → HTML reply draft.
      // Mirrors Make.com: new email → AI classify → Sheets filterRows → AI reply → Gmail draft.
      if (!sb) throw new Error("smart_triage requires internal Supabase client");

      const limit           = Math.min(Number(p.limit ?? 10), 25);
      const spreadsheetId   = String(p.spreadsheet_id ?? "");
      const sheetName       = String(p.sheet_name ?? "Prompts");
      const signature       = p.signature ? String(p.signature) : "";
      const stateKey        = String(p.state_key ?? "smart_triage_state");
      const markReadAfter   = Boolean(p.mark_read ?? false);
      const categories: string[] = Array.isArray(p.categories)
        ? p.categories.map(String)
        : ["Inquiry/Requests", "Complaints/Issues", "Job Applications/Resumes"];

      if (!spreadsheetId) return { error: "spreadsheet_id required for smart_triage" };

      // Load watermark
      const { data: stateRow } = await sb
        .from("mavis_memory")
        .select("id, content")
        .eq("user_id", uid)
        .contains("tags", [stateKey])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastCheckEpoch: number = stateRow
        ? (JSON.parse(stateRow.content ?? "{}").last_check_epoch ?? 0)
        : 0;

      // Fetch new unread emails
      const afterFilter = lastCheckEpoch > 0 ? ` after:${lastCheckEpoch}` : "";
      const q = encodeURIComponent(`is:unread -from:me -category:promotions -category:social${afterFilter}`);
      const listRes = await gReq(token, `${GMAIL_API}/users/me/messages?maxResults=${limit}&q=${q}`);
      const msgIds: string[] = (listRes.messages ?? []).map((m: any) => m.id);

      const nowEpoch = Math.floor(Date.now() / 1000);
      const results: any[] = [];
      let draftsCreated = 0;

      // Pre-load prompt table from Sheets (one call; columns A=Category, B=Prompt)
      const promptMap: Record<string, string> = {};
      try {
        const sheetsRes = await fetch(`${SB_URL}/functions/v1/mavis-sheets-agent`, {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
          body: JSON.stringify({
            userId:         uid,
            action:         "get_range",
            spreadsheet_id: spreadsheetId,
            sheet_name:     sheetName,
            range:          `${sheetName}!A:B`,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const sheetsData = await sheetsRes.json().catch(() => ({})) as any;
        const rows: string[][] = sheetsData.values ?? [];
        rows.slice(1).forEach(row => {
          if (row[0] && row[1]) promptMap[row[0].trim()] = row[1];
        });
      } catch (_) { /* Sheets unavailable — use default prompt */ }

      const defaultPromptSys =
        `You are a professional email responder. Write a helpful, friendly reply in HTML format.\n` +
        `Address the sender by their first name.\n` +
        `Sign off with "Best,${signature ? `\n${signature}` : ""}".\n` +
        `Use proper HTML: <p> tags for paragraphs, no markdown.`;

      const classifySystem =
        `Categorize the following email into exactly one of these categories:\n` +
        categories.map(c => `- ${c}`).join("\n") +
        `\nReturn ONLY the category name, nothing else.`;

      for (const msgId of msgIds) {
        try {
          const msg = await gReq(token, `${GMAIL_API}/users/me/messages/${msgId}?format=full`);
          const hdrs: { name: string; value: string }[] = msg.payload?.headers ?? [];
          const h = (name: string) => hdrs.find((hh: any) => hh.name === name)?.value ?? "";
          const from      = h("From");
          const subject   = h("Subject");
          const messageId = h("Message-ID");
          const body      = decodeMessageBody(msg.payload) || msg.snippet;
          const toAddr    = from.match(/<([^>]+)>/) ? from.match(/<([^>]+)>/)![1] : from;
          const senderName = (from.split(/[<@]/)[0] ?? "").trim().split(" ")[0] || "there";

          const emailCtx = `From: ${from}\nSubject: ${subject}\n\n${body.slice(0, 2000)}`;

          // Classify the email
          const category = (await callClaude(classifySystem, emailCtx, "claude-haiku-4-5-20251001", 64)).trim();

          // Lookup category-specific prompt (exact → partial → default)
          let categoryPrompt = promptMap[category] ?? "";
          if (!categoryPrompt) {
            const key = Object.keys(promptMap).find(k =>
              k.toLowerCase().includes(category.toLowerCase()) ||
              category.toLowerCase().includes(k.toLowerCase())
            );
            if (key) categoryPrompt = promptMap[key];
          }

          const replySystem = categoryPrompt
            ? `${categoryPrompt}\n\nAddress the sender by their first name: ${senderName}.\nEnsure the email body is in HTML format with proper <p> tags.\nSign off with "Best,${signature ? `\n${signature}` : ""}".`
            : defaultPromptSys;

          // Generate HTML reply
          const replyInput =
            `${emailCtx}\n\nAddress it to the sender's first name: ${senderName}\nEnsure that the email body is in HTML format.`;
          const htmlReply = await callClaude(replySystem, replyInput, "claude-sonnet-4-6", 1024);

          // Wrap in <p> tags if model returned plain text
          const htmlBody = htmlReply.trimStart().startsWith("<")
            ? htmlReply
            : `<p>${htmlReply.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;

          const plainText = htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

          const draft = await gReq(token, `${GMAIL_API}/users/me/drafts`, "POST", {
            message: {
              raw: encodeMime(toAddr, `Re: ${subject}`, plainText, {
                threadId:   msg.threadId,
                inReplyTo:  messageId ? `<${messageId}>` : undefined,
                references: messageId ? `<${messageId}>` : undefined,
                htmlBody,
              }),
              threadId: msg.threadId,
            },
          });

          if (markReadAfter) {
            await gReq(token, `${GMAIL_API}/users/me/messages/${msgId}/modify`, "POST", {
              removeLabelIds: ["UNREAD"],
            }).catch(() => {});
          }

          results.push({
            message_id:    msgId,
            from,
            subject,
            category,
            prompt_found:  !!categoryPrompt,
            draft_id:      draft.id,
            reply_preview: plainText.slice(0, 200),
          });
          draftsCreated++;
        } catch (e: unknown) {
          results.push({ message_id: msgId, error: e instanceof Error ? e.message : String(e) });
        }
      }

      // Persist watermark
      const newState = JSON.stringify({ last_check_epoch: nowEpoch, last_run: new Date().toISOString() });
      if (stateRow) {
        await sb.from("mavis_memory").update({ content: newState }).eq("id", (stateRow as any).id);
      } else {
        await sb.from("mavis_memory").insert({
          user_id:    uid,
          role:       "assistant",
          content:    newState,
          tags:       [stateKey, "email_smart_triage", "system_state"],
          importance: 3,
        });
      }

      return {
        processed:       msgIds.length,
        drafts_created:  draftsCreated,
        categories_seen: [...new Set(results.map((r: any) => r.category).filter(Boolean))],
        results,
      };
    }

    default:
      throw new Error(`Unknown Gmail action: ${action}`);
  }
}

// ── DRIVE actions ─────────────────────────────────────────────────────────────

async function handleDrive(action: string, p: any, token: string): Promise<any> {
  switch (action) {
    case "list_files": {
      const max    = Math.min(Number(p.max_results ?? 20), 100);
      const query  = p.query ? `&q=${encodeURIComponent(String(p.query))}` : "";
      const fields = "files(id,name,mimeType,modifiedTime,webViewLink,size)";
      const data   = await gReq(token, `${DRIVE_API}/files?pageSize=${max}&fields=${fields}&orderBy=modifiedTime+desc${query}`);
      return { files: data.files ?? [], next_page_token: data.nextPageToken };
    }

    case "create_folder": {
      const name     = String(p.name ?? "MAVIS Folder");
      const parentId = p.parent_id ? String(p.parent_id) : undefined;
      const meta: Record<string, any> = {
        name,
        mimeType: "application/vnd.google-apps.folder",
      };
      if (parentId) meta.parents = [parentId];
      return gReq(token, `${DRIVE_API}/files`, "POST", meta);
    }

    case "upload_text": {
      const name     = String(p.name ?? `mavis-${Date.now()}.txt`);
      const content  = String(p.content ?? "");
      const mimeType = String(p.mime_type ?? "text/plain");
      const parentId = p.parent_id ? String(p.parent_id) : undefined;

      const meta: Record<string, any> = { name, mimeType };
      if (parentId) meta.parents = [parentId];

      const boundary = "---mavis_boundary";
      const body = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(meta),
        `--${boundary}`,
        `Content-Type: ${mimeType}`,
        "",
        content,
        `--${boundary}--`,
      ].join("\r\n");

      const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Drive upload failed (${res.status}): ${err.slice(0, 200)}`);
      }
      return res.json();
    }

    default:
      throw new Error(`Unknown Drive action: ${action}`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const adminSb  = createClient(SB_URL, SB_SRK);
    const authHeader = req.headers.get("Authorization") ?? "";
    const body       = await req.json().catch(() => ({}));

    // ── Auth: service-role internal call (userId in body) or JWT ─────────────
    let uid: string | null = null;

    if (authHeader === `Bearer ${SB_SRK}`) {
      // Internal call from mavis-actions / task-executor
      uid = String(body.userId ?? body.user_id ?? "").trim() || null;
      if (!uid) return json({ error: "userId required for service-role calls" }, 400);
    } else if (authHeader.startsWith("Bearer ")) {
      const { data: { user }, error } = await adminSb.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      uid = user.id;
    } else {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const action = String(body.action ?? "");
    if (!action) return json({ error: "action is required" }, 400);

    // ── Route to the right Google service ────────────────────────────────────

    if (action.includes("calendar") || action === "find_free_time" || action === "create_meet_link") {
      const token = await getToken(adminSb, uid, "google_calendar");
      const result = await handleCalendar(action, body, token, adminSb, uid);
      return json(result);
    }

    const GMAIL_ACTIONS = ["send_email", "create_draft", "dual_draft", "get_email", "mark_read",
                           "triage_inbox", "list_emails", "search_emails", "watch_new_emails", "smart_triage"];
    if (GMAIL_ACTIONS.includes(action) || action.includes("email") || action.includes("gmail")) {
      const token = await getToken(adminSb, uid, "gmail");
      const result = await handleGmail(action, body, token, uid, adminSb);
      return json(result);
    }

    if (action.includes("file") || action.includes("folder") || action.includes("drive") || action === "upload_text") {
      const token = await getToken(adminSb, uid, "gdrive");
      const result = await handleDrive(action, body, token);
      return json(result);
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-google-agent]", message);

    // Return graceful error for unconnected integrations
    const status = message.includes("not connected") ? 503 : 500;
    return json({ error: message }, status);
  }
});
