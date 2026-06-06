// MAVIS Calendar Manage — autonomous calendar operations via Google Calendar API.
// Finds free time, creates events, reschedules, and cancels on the operator's behalf.
//
// Actions: find_free_time | create_event | reschedule_event | cancel_event | list_events
//
// Requires: GOOGLE_ACCESS_TOKEN or a valid OAuth token from the user's linked Google account.
// The token is fetched from user_integrations table (provider = 'google_calendar').

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GC_API = "https://www.googleapis.com/calendar/v3";

async function getGoogleToken(sb: any, userId: string): Promise<string | null> {
  const { data } = await sb
    .from("user_integrations")
    .select("access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", "google_calendar")
    .single();
  if (!data?.access_token) return null;
  // If token expires within 5 minutes, we'd need to refresh — but that requires client_id/secret
  // Caller handles refresh via their OAuth flow
  return data.access_token;
}

async function gcRequest(token: string, path: string, method = "GET", body?: object): Promise<any> {
  const res = await fetch(`${GC_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Calendar API ${res.status}: ${err.slice(0, 200)}`);
  }
  return method === "DELETE" ? {} : res.json();
}

function toRFC3339(dateStr: string, timeStr?: string): string {
  if (timeStr) return new Date(`${dateStr}T${timeStr}`).toISOString();
  return new Date(dateStr).toISOString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list_events");

    const token = await getGoogleToken(sb, user.id);
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Google Calendar not connected. Connect it in Integrations → Google Calendar." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let result: any;

    switch (action) {
      case "list_events": {
        const calId = encodeURIComponent(String(body.calendar_id ?? "primary"));
        const timeMin = body.time_min ? new Date(body.time_min).toISOString() : new Date().toISOString();
        const timeMax = body.time_max ? new Date(body.time_max).toISOString() : new Date(Date.now() + 7 * 86400_000).toISOString();
        const maxResults = Math.min(Number(body.max_results ?? 20), 50);

        result = await gcRequest(token, `/calendars/${calId}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`);
        break;
      }

      case "find_free_time": {
        const durationMin = Number(body.duration_minutes ?? 60);
        const startDate = body.start_date ? new Date(body.start_date) : new Date();
        const endDate = body.end_date ? new Date(body.end_date) : new Date(Date.now() + 3 * 86400_000);
        const workStartHour = Number(body.work_start ?? 9);
        const workEndHour = Number(body.work_end ?? 18);

        // Get busy slots
        const freeBusy = await gcRequest(token, "/freeBusy", "POST", {
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          items: [{ id: "primary" }],
        });

        const busy: { start: Date; end: Date }[] = (freeBusy.calendars?.primary?.busy ?? []).map((b: any) => ({
          start: new Date(b.start),
          end: new Date(b.end),
        }));

        // Find free slots within work hours
        const freeSlots: { start: string; end: string }[] = [];
        let cursor = new Date(startDate);
        cursor.setHours(workStartHour, 0, 0, 0);

        while (cursor < endDate && freeSlots.length < 5) {
          if (cursor.getHours() >= workEndHour) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(workStartHour, 0, 0, 0);
            continue;
          }
          const slotEnd = new Date(cursor.getTime() + durationMin * 60_000);
          const conflict = busy.some(b => cursor < b.end && slotEnd > b.start);
          if (!conflict && slotEnd.getHours() <= workEndHour) {
            freeSlots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
            cursor = slotEnd;
          } else {
            cursor = new Date(cursor.getTime() + 15 * 60_000);
          }
        }

        result = { free_slots: freeSlots, duration_minutes: durationMin };
        break;
      }

      case "create_event": {
        const calId = encodeURIComponent(String(body.calendar_id ?? "primary"));
        const event: any = {
          summary: String(body.title ?? "MAVIS Scheduled Event"),
          description: body.description ? String(body.description) : undefined,
          start: body.all_day
            ? { date: String(body.start_date) }
            : { dateTime: toRFC3339(String(body.start_date ?? new Date().toISOString().split("T")[0]), body.start_time), timeZone: body.timezone ?? "America/New_York" },
          end: body.all_day
            ? { date: String(body.end_date ?? body.start_date) }
            : { dateTime: toRFC3339(String(body.end_date ?? body.start_date), body.end_time ?? "10:00:00"), timeZone: body.timezone ?? "America/New_York" },
          location: body.location ? String(body.location) : undefined,
          attendees: body.attendees ? (body.attendees as string[]).map((email: string) => ({ email })) : undefined,
        };

        result = await gcRequest(token, `/calendars/${calId}/events`, "POST", event);

        // Store in MAVIS memory
        await sb.from("mavis_memory").insert({
          user_id: user.id,
          role: "assistant",
          content: `[CALENDAR EVENT CREATED] "${event.summary}" on ${event.start.dateTime ?? event.start.date}${event.location ? ` at ${event.location}` : ""}`,
          importance_score: 6,
          tags: ["calendar", "event_created"],
        });
        break;
      }

      case "reschedule_event": {
        const eventId = String(body.event_id ?? "");
        const calId = encodeURIComponent(String(body.calendar_id ?? "primary"));
        if (!eventId) throw new Error("event_id required");

        const existing = await gcRequest(token, `/calendars/${calId}/events/${eventId}`);
        const updated = {
          ...existing,
          start: body.all_day
            ? { date: String(body.start_date) }
            : { dateTime: toRFC3339(String(body.start_date), body.start_time), timeZone: existing.start?.timeZone ?? "America/New_York" },
          end: body.all_day
            ? { date: String(body.end_date ?? body.start_date) }
            : { dateTime: toRFC3339(String(body.end_date ?? body.start_date), body.end_time), timeZone: existing.end?.timeZone ?? "America/New_York" },
        };

        result = await gcRequest(token, `/calendars/${calId}/events/${eventId}`, "PUT", updated);
        break;
      }

      case "cancel_event": {
        const eventId = String(body.event_id ?? "");
        const calId = encodeURIComponent(String(body.calendar_id ?? "primary"));
        if (!eventId) throw new Error("event_id required");
        await gcRequest(token, `/calendars/${calId}/events/${eventId}`, "DELETE");
        result = { deleted: true, event_id: eventId };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}. Use: list_events | find_free_time | create_event | reschedule_event | cancel_event`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[mavis-calendar-manage]", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
