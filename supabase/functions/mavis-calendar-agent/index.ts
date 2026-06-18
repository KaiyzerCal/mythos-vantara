// MAVIS Calendar Agent — full Google Calendar CRUD via Google Calendar API.
// Mirrors n8n MCP_CALENDAR: get_event, get_all_events, check_availability,
// delete_event, update_event, create_event.
//
// Auth: mavis_user_integrations provider='google' with auto-refresh.
// calendar_id defaults to "primary"; pass specific IDs for shared/group calendars.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_ID     = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

const GCAL_API = "https://www.googleapis.com/calendar/v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshGoogleToken(cfg: Record<string, unknown>, sb: ReturnType<typeof createClient>, uid: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     GOOGLE_ID,
      client_secret: GOOGLE_SECRET,
      refresh_token: cfg.refresh_token as string,
      grant_type:    "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const tokens = await res.json();
  const updated = { ...cfg, access_token: tokens.access_token, expires_at: Date.now() + (tokens.expires_in ?? 3599) * 1000 };
  await sb.from("mavis_user_integrations").upsert({ user_id: uid, provider: "google", config: updated, updated_at: new Date().toISOString() }, { onConflict: "user_id,provider" });
  return tokens.access_token as string;
}

async function getGoogleToken(sb: ReturnType<typeof createClient>, uid: string): Promise<string> {
  const { data } = await sb.from("mavis_user_integrations").select("config").eq("user_id", uid).eq("provider", "google").single();
  if (!data?.config?.access_token) throw new Error("Google account not connected. Link your Google account in MAVIS settings.");
  const cfg = data.config as Record<string, unknown>;
  if (typeof cfg.expires_at === "number" && cfg.expires_at > Date.now() + 60_000) return cfg.access_token as string;
  return refreshGoogleToken(cfg, sb, uid);
}

async function gcal(token: string, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${GCAL_API}${path}`, {
    method,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { userId, action, calendar_id = "primary", timezone = "America/Sao_Paulo", ...p } = body as Record<string, unknown>;

    if (!userId) throw new Error("userId required");
    if (!action)  throw new Error("action required");

    const adminSb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
    const token   = await getGoogleToken(adminSb, userId as string);
    const calId   = encodeURIComponent(calendar_id as string);
    const tz      = timezone as string;

    let result: unknown;

    switch (action as string) {
      // ── GET SINGLE EVENT ────────────────────────────────────────────────────
      case "get_event": {
        const { event_id } = p as { event_id: string };
        if (!event_id) throw new Error("event_id required");
        const r = await gcal(token, "GET", `/calendars/${calId}/events/${encodeURIComponent(event_id)}`);
        if (!r.ok) throw new Error(`Google Calendar error ${r.status}: ${JSON.stringify(r.data)}`);
        result = r.data;
        break;
      }

      // ── LIST ALL EVENTS IN DATE RANGE ───────────────────────────────────────
      case "get_all_events": {
        const { time_min, time_after, time_max, time_before, max_results, query } = p as Record<string, string>;
        const params = new URLSearchParams({ orderBy: "startTime", singleEvents: "true", timeZone: tz });
        const after  = time_min  ?? time_after;
        const before = time_max  ?? time_before;
        if (after)       params.set("timeMin",    after);
        if (before)      params.set("timeMax",    before);
        if (max_results) params.set("maxResults", max_results);
        if (query)       params.set("q",          query);
        const r = await gcal(token, "GET", `/calendars/${calId}/events?${params}`);
        if (!r.ok) throw new Error(`Google Calendar error ${r.status}: ${JSON.stringify(r.data)}`);
        const items = ((r.data as Record<string, unknown>).items ?? []) as unknown[];
        result = { events: items, count: items.length, calendar_id };
        break;
      }

      // ── CHECK AVAILABILITY (freeBusy) ───────────────────────────────────────
      case "check_availability": {
        const { start_time, end_time } = p as { start_time: string; end_time: string };
        if (!start_time || !end_time) throw new Error("start_time and end_time required");
        const r = await gcal(token, "POST", "/freeBusy", {
          timeMin:  start_time,
          timeMax:  end_time,
          timeZone: tz,
          items:    [{ id: calendar_id as string }],
        });
        if (!r.ok) throw new Error(`Google Calendar error ${r.status}: ${JSON.stringify(r.data)}`);
        const busy = ((r.data as Record<string, unknown>).calendars as Record<string, { busy: unknown[] }>)?.[calendar_id as string]?.busy ?? [];
        result = { available: busy.length === 0, busy_periods: busy, time_min: start_time, time_max: end_time, timezone: tz };
        break;
      }

      // ── DELETE EVENT ────────────────────────────────────────────────────────
      case "delete_event": {
        const { event_id } = p as { event_id: string };
        if (!event_id) throw new Error("event_id required");
        const r = await gcal(token, "DELETE", `/calendars/${calId}/events/${encodeURIComponent(event_id)}`);
        // 410 Gone = already deleted — treat as success
        if (!r.ok && r.status !== 410) throw new Error(`Google Calendar error ${r.status}: ${JSON.stringify(r.data)}`);
        result = { deleted: true, event_id };
        break;
      }

      // ── UPDATE EVENT (PATCH) ────────────────────────────────────────────────
      case "update_event": {
        const { event_id, summary, description, start, end, location, attendees, use_default_reminders, reminders } = p as Record<string, unknown>;
        if (!event_id) throw new Error("event_id required");
        const patch: Record<string, unknown> = {};
        if (summary     !== undefined) patch.summary     = summary;
        if (description !== undefined) patch.description = description;
        if (location    !== undefined) patch.location    = location;
        if (attendees   !== undefined) patch.attendees   = attendees;
        if (start !== undefined) patch.start = typeof start === "string" ? { dateTime: start, timeZone: tz } : start;
        if (end   !== undefined) patch.end   = typeof end   === "string" ? { dateTime: end,   timeZone: tz } : end;
        if (use_default_reminders === false && reminders) patch.reminders = reminders;
        const r = await gcal(token, "PATCH", `/calendars/${calId}/events/${encodeURIComponent(event_id as string)}`, patch);
        if (!r.ok) throw new Error(`Google Calendar error ${r.status}: ${JSON.stringify(r.data)}`);
        result = r.data;
        break;
      }

      // ── CREATE EVENT ────────────────────────────────────────────────────────
      case "create_event": {
        const { summary, description, start, end, location, attendees, use_default_reminders = true, reminders } = p as Record<string, unknown>;
        if (!start || !end) throw new Error("start and end required");
        const event: Record<string, unknown> = {
          summary: summary ?? "MAVIS Event",
          start:   typeof start === "string" ? { dateTime: start, timeZone: tz } : start,
          end:     typeof end   === "string" ? { dateTime: end,   timeZone: tz } : end,
        };
        if (description)                          event.description = description;
        if (location)                             event.location    = location;
        if (attendees)                            event.attendees   = attendees;
        if (use_default_reminders === false && reminders) event.reminders = reminders;
        const r = await gcal(token, "POST", `/calendars/${calId}/events`, event);
        if (!r.ok) throw new Error(`Google Calendar error ${r.status}: ${JSON.stringify(r.data)}`);
        result = r.data;
        break;
      }

      default:
        throw new Error(`Unknown calendar action: ${action}. Supported: get_event, get_all_events, check_availability, delete_event, update_event, create_event`);
    }

    await adminSb.from("mavis_memory").insert({
      user_id:    userId,
      content:    `Calendar ${action} on ${calendar_id}: ${JSON.stringify(result).slice(0, 400)}`,
      importance: 3,
      tags:       ["calendar", "google_calendar", action as string],
    }).then(() => {});

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
