// MAVIS Calendar Sync
// Fetches an iCal URL, parses VEVENT blocks, filters to events in the next N days,
// and upserts them into the calendar_events table for the authenticated user.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─────────────────────────────────────────────────────────────
// iCal parser
// ─────────────────────────────────────────────────────────────

interface CalEvent {
  uid:         string;
  title:       string;
  start_raw:   string;
  end_raw:     string;
  description: string;
  location:    string;
}

/**
 * Unfold RFC 5545 line continuations (lines starting with space/tab are
 * continuations of the previous line).
 */
function unfoldLines(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

/**
 * Parse all VEVENT blocks from iCal text.
 * Handles property parameters (e.g. DTSTART;TZID=America/New_York:20240101T090000).
 */
function parseIcal(text: string): CalEvent[] {
  const events: CalEvent[] = [];
  const unfolded = unfoldLines(text);
  const blocks   = unfolded.split("BEGIN:VEVENT");

  for (const block of blocks.slice(1)) {
    const lines = block.split(/\r?\n/);
    const event: Partial<CalEvent> = {};

    for (const line of lines) {
      if (line.startsWith("END:VEVENT")) break;

      // Strip property parameters: e.g. DTSTART;TZID=...:VALUE → keep "DTSTART:VALUE"
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const propRaw = line.slice(0, colonIdx);
      const value   = line.slice(colonIdx + 1).trim();
      // Property name is everything before the first ; or :
      const propName = propRaw.split(";")[0].toUpperCase();

      switch (propName) {
        case "SUMMARY":     event.title       = value; break;
        case "DTSTART":     event.start_raw   = value; break;
        case "DTEND":       event.end_raw     = value; break;
        case "DESCRIPTION": event.description = value.replace(/\\n/g, "\n").replace(/\\,/g, ","); break;
        case "LOCATION":    event.location    = value.replace(/\\,/g, ","); break;
        case "UID":         event.uid         = value; break;
      }
    }

    if (event.title && event.uid) {
      events.push({
        uid:         event.uid         ?? "",
        title:       event.title       ?? "(no title)",
        start_raw:   event.start_raw   ?? "",
        end_raw:     event.end_raw     ?? "",
        description: event.description ?? "",
        location:    event.location    ?? "",
      });
    }
  }

  return events;
}

/**
 * Parse an iCal date/datetime string into a JS Date.
 * Handles: YYYYMMDD, YYYYMMDDTHHmmss, YYYYMMDDTHHmmssZ
 */
function parseIcalDate(raw: string): Date | null {
  if (!raw) return null;
  try {
    // All-day date: YYYYMMDD
    if (/^\d{8}$/.test(raw)) {
      return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`);
    }
    // Datetime: YYYYMMDDTHHmmss[Z]
    if (/^\d{8}T\d{6}Z?$/.test(raw)) {
      const dt = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}`;
      return new Date(raw.endsWith("Z") ? dt + "Z" : dt);
    }
    // Fallback: let the engine try
    return new Date(raw);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: bearer token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const jwt = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let body: { ical_url: string; days_ahead?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { ical_url, days_ahead = 14 } = body;
  const safeDays = Math.min(Math.max(1, days_ahead), 365);

  // ── Google Calendar API path (OAuth) ──────────────────────────────────────
  // If the user has connected Google via OAuth, prefer the Calendar API over iCal.
  const { data: gcalRow } = await supabase
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", user.id)
    .eq("provider", "google_calendar")
    .single();

  if (gcalRow?.config?.refresh_token) {
    let token: string = gcalRow.config.access_token;
    const expiresAt: number = gcalRow.config.expires_at ?? 0;
    if (expiresAt < Date.now() / 1000 + 300) {
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     gcalRow.config.client_id,
          client_secret: gcalRow.config.client_secret,
          refresh_token: gcalRow.config.refresh_token,
          grant_type:    "refresh_token",
        }),
      });
      const refreshData = await refreshRes.json();
      if (refreshData.access_token) {
        token = refreshData.access_token;
        await supabase.from("mavis_user_integrations").update({
          config: { ...gcalRow.config, access_token: token, expires_at: Math.floor(Date.now() / 1000) + (refreshData.expires_in ?? 3600) },
        }).eq("user_id", user.id).eq("provider", "google_calendar");
      }
    }

    const now     = new Date();
    const horizon = new Date(now.getTime() + safeDays * 86400_000);
    const calRes  = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      new URLSearchParams({
        timeMin:      now.toISOString(),
        timeMax:      horizon.toISOString(),
        singleEvents: "true",
        orderBy:      "startTime",
        maxResults:   "100",
      }),
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (calRes.ok) {
      const calData = await calRes.json();
      const items: any[] = calData.items ?? [];
      const rows = items.map((e: any) => ({
        user_id:     user.id,
        event_uid:   e.id,
        title:       e.summary ?? "Untitled",
        start_at:    e.start?.dateTime ?? e.start?.date ?? now.toISOString(),
        end_at:      e.end?.dateTime   ?? e.end?.date   ?? null,
        description: e.description    ?? null,
        location:    e.location       ?? null,
        ical_url:    "google_calendar_api",
        synced_at:   now.toISOString(),
      }));

      if (rows.length > 0) {
        await supabase.from("calendar_events").upsert(rows, { onConflict: "user_id,event_uid" });
      }

      return new Response(
        JSON.stringify({ events: rows.map(r => ({ title: r.title, start_at: r.start_at, end_at: r.end_at, location: r.location })), count: rows.length, source: "google_calendar_api" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // ── iCal fallback ─────────────────────────────────────────────────────────
  if (!ical_url?.trim()) {
    return new Response(
      JSON.stringify({ error: "ical_url is required (or connect Google Calendar via Integrations)" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Fetch the iCal file
  let icalText: string;
  try {
    const icalRes = await fetch(ical_url, { signal: AbortSignal.timeout(20000) });
    if (!icalRes.ok) {
      throw new Error(`Failed to fetch iCal (${icalRes.status})`);
    }
    icalText = await icalRes.text();
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: `Could not retrieve iCal: ${e?.message}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!icalText.includes("BEGIN:VCALENDAR")) {
    return new Response(
      JSON.stringify({ error: "URL does not appear to be a valid iCal file" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Parse and filter
  const now      = new Date();
  const horizon  = new Date(now.getTime() + safeDays * 86400_000);
  const allParsed = parseIcal(icalText);
  const syncedAt  = now.toISOString();

  const upcoming = allParsed
    .map((e) => ({ ...e, startDate: parseIcalDate(e.start_raw), endDate: parseIcalDate(e.end_raw) }))
    .filter(({ startDate }) => startDate !== null && startDate >= now && startDate <= horizon)
    .sort((a, b) => (a.startDate!.getTime()) - (b.startDate!.getTime()));

  // Upsert into calendar_events
  let upsertCount = 0;
  if (upcoming.length > 0) {
    const rows = upcoming.map(({ uid, title, startDate, endDate, description, location }) => ({
      user_id:     user.id,
      event_uid:   uid,
      title,
      start_at:    startDate!.toISOString(),
      end_at:      endDate ? endDate.toISOString() : null,
      description: description || null,
      location:    location   || null,
      ical_url,
      synced_at:   syncedAt,
    }));

    const { error: upsertErr } = await supabase
      .from("calendar_events")
      .upsert(rows, { onConflict: "user_id,event_uid" });

    if (upsertErr) {
      console.error("[mavis-calendar-sync] upsert error:", upsertErr.message);
      return new Response(
        JSON.stringify({ error: `Database upsert failed: ${upsertErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    upsertCount = rows.length;
  }

  const events = upcoming.map(({ title, startDate, endDate, location }) => ({
    title,
    start_at:  startDate!.toISOString(),
    end_at:    endDate ? endDate.toISOString() : null,
    location:  location || null,
  }));

  return new Response(
    JSON.stringify({ events, count: upsertCount }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
