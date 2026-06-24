// MAVIS Booking — Venue search + reservation management
// Actions: find_venue | create_booking | list_bookings | cancel_booking | update_booking

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS  = "https://overpass-api.de/api/interpreter";
const UA        = "MAVIS/1.0 (mavis-booking edge function)";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient() {
  return createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
}

async function resolveUserId(req: Request, bodyUserId?: string): Promise<string | null> {
  if (bodyUserId) return bodyUserId;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (token === SB_SRK) return null;
  const sb = createClient(SB_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? SB_SRK, { auth: { persistSession: false } });
  const { data: { user } } = await sb.auth.getUser(token);
  return user?.id ?? null;
}

async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  const res = await fetch(
    `${NOMINATIM}/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
    { headers: { "User-Agent": UA } },
  );
  const results = await res.json();
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

async function hasGoogleConnected(sb: ReturnType<typeof adminClient>, userId: string): Promise<boolean> {
  const { data } = await sb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", userId)
    .eq("provider", "google")
    .single();
  return !!(data?.config?.access_token || data?.config?.refresh_token);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = (body.action as string) ?? "";

    if (!action) return json({ error: "action required" }, 400);

    // ── FIND VENUE ──────────────────────────────────────────────────────────────
    if (action === "find_venue") {
      const query    = (body.query as string) ?? "";
      const location = (body.location as string) ?? "";
      const radius   = Math.min(Number(body.radius_m ?? 1000), 5000);

      let lat = body.latitude  != null ? parseFloat(body.latitude as string)  : null;
      let lon = body.longitude != null ? parseFloat(body.longitude as string) : null;

      if ((lat == null || lon == null) && location) {
        const coords = await geocode(location);
        if (!coords) return json({ error: `Could not geocode location: ${location}` }, 400);
        lat = coords.lat;
        lon = coords.lon;
      }

      if (lat == null || lon == null) {
        return json({ error: "latitude/longitude or location required" }, 400);
      }

      const overpassQuery = `
[out:json][timeout:15];
(
  node["amenity"~"restaurant|cafe|bar|fast_food"]["name"](around:${radius},${lat},${lon});
  node["tourism"~"hotel|hostel"]["name"](around:${radius},${lat},${lon});
  node["shop"]["name"](around:${radius},${lat},${lon});
);
out body 15;
`.trim();

      const overpassRes = await fetch(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      });

      if (!overpassRes.ok) {
        throw new Error(`Overpass API error: ${overpassRes.status}`);
      }

      const overpassData = await overpassRes.json();
      const queryLower = query.toLowerCase();

      const venues = (overpassData.elements ?? [] as unknown[])
        .filter((e: unknown) => {
          const el = e as Record<string, unknown>;
          const tags = (el.tags ?? {}) as Record<string, string>;
          if (!query) return true;
          const name    = (tags.name ?? "").toLowerCase();
          const cuisine = (tags.cuisine ?? "").toLowerCase();
          const amenity = (tags.amenity ?? "").toLowerCase();
          const shop    = (tags.shop ?? "").toLowerCase();
          return name.includes(queryLower) || cuisine.includes(queryLower) || amenity.includes(queryLower) || shop.includes(queryLower);
        })
        .slice(0, 10)
        .map((e: unknown) => {
          const el = e as Record<string, unknown>;
          const tags = (el.tags ?? {}) as Record<string, string>;
          const addrParts = [
            tags["addr:housenumber"],
            tags["addr:street"],
            tags["addr:city"],
          ].filter(Boolean);
          return {
            name:    tags.name ?? "Unnamed",
            amenity: tags.amenity ?? tags.tourism ?? tags.shop ?? null,
            lat:     el.lat as number,
            lon:     el.lon as number,
            address: addrParts.length ? addrParts.join(" ") : null,
            tags: {
              cuisine:  tags.cuisine  ?? null,
              phone:    tags.phone    ?? null,
              website:  tags.website  ?? null,
              opening_hours: tags.opening_hours ?? null,
            },
          };
        });

      return json({ ok: true, venues, count: venues.length, center: { lat, lon }, radius_m: radius });
    }

    // ── CREATE BOOKING ──────────────────────────────────────────────────────────
    if (action === "create_booking") {
      const userId = await resolveUserId(req, body.userId as string | undefined);
      if (!userId) return json({ error: "userId required" }, 400);

      const { title, booking_type, location, start_time, end_time, description, attendees, add_to_calendar } = body as Record<string, unknown>;

      if (!title)        return json({ error: "title required" }, 400);
      if (!booking_type) return json({ error: "booking_type required" }, 400);
      if (!start_time)   return json({ error: "start_time required" }, 400);

      const validTypes = ["restaurant", "hotel", "service", "custom"];
      if (!validTypes.includes(booking_type as string)) {
        return json({ error: `booking_type must be one of: ${validTypes.join(", ")}` }, 400);
      }

      const sb = adminClient();

      const { data: booking, error: insertErr } = await sb
        .from("mavis_bookings")
        .insert({
          user_id:      userId,
          booking_type: booking_type as string,
          title:        title as string,
          description:  (description as string) ?? null,
          location:     (location as string) ?? null,
          start_time:   start_time as string,
          end_time:     (end_time as string) ?? null,
          attendees:    (attendees as unknown[]) ?? null,
          status:       "confirmed",
          metadata:     {},
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(`DB insert failed: ${insertErr.message}`);

      const bookingId = booking.id as string;
      let calendarEventId: string | null = null;

      if (add_to_calendar) {
        const connected = await hasGoogleConnected(sb, userId);
        if (connected) {
          const endIso = (end_time as string) ??
            new Date(new Date(start_time as string).getTime() + 3_600_000).toISOString();

          const calRes = await fetch(`${SB_URL}/functions/v1/mavis-calendar-agent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SB_SRK}`,
            },
            body: JSON.stringify({
              userId,
              action:      "create_event",
              title:       title as string,
              start:       start_time as string,
              end:         endIso,
              location:    (location as string) ?? "",
              description: `${(description as string) ?? ""}\n\nMAVIS Booking ID: ${bookingId}`.trim(),
            }),
            signal: AbortSignal.timeout(15_000),
          });

          if (calRes.ok) {
            const calData = await calRes.json() as Record<string, unknown>;
            calendarEventId = (calData.id as string) ?? null;

            if (calendarEventId) {
              await sb
                .from("mavis_bookings")
                .update({ metadata: { calendar_event_id: calendarEventId } })
                .eq("id", bookingId);
            }
          } else {
            console.warn("mavis-booking: calendar event creation failed", await calRes.text());
          }
        }
      }

      return json({
        ok:               true,
        booking_id:       bookingId,
        status:           "confirmed",
        ...(calendarEventId ? { calendar_event_id: calendarEventId } : {}),
      });
    }

    // ── LIST BOOKINGS ───────────────────────────────────────────────────────────
    if (action === "list_bookings") {
      const userId = await resolveUserId(req, body.userId as string | undefined);
      if (!userId) return json({ error: "userId required" }, 400);

      const status    = body.status    as string | undefined;
      const limit     = Math.min(Number(body.limit ?? 20), 100);
      const from_date = (body.from_date as string) ?? new Date().toISOString();

      const sb = adminClient();

      let q = sb
        .from("mavis_bookings")
        .select("*")
        .eq("user_id", userId)
        .gte("start_time", from_date)
        .order("start_time", { ascending: true })
        .limit(limit);

      if (status) q = q.eq("status", status);

      const { data: bookings, error: queryErr } = await q;
      if (queryErr) throw new Error(`DB query failed: ${queryErr.message}`);

      return json({ ok: true, bookings: bookings ?? [], count: (bookings ?? []).length });
    }

    // ── CANCEL BOOKING ──────────────────────────────────────────────────────────
    if (action === "cancel_booking") {
      const userId    = await resolveUserId(req, body.userId as string | undefined);
      const bookingId = body.booking_id as string | undefined;

      if (!userId)    return json({ error: "userId required" }, 400);
      if (!bookingId) return json({ error: "booking_id required" }, 400);

      const sb = adminClient();

      const { error: updateErr } = await sb
        .from("mavis_bookings")
        .update({ status: "cancelled" })
        .eq("id", bookingId)
        .eq("user_id", userId);

      if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

      return json({ ok: true, cancelled: bookingId });
    }

    // ── UPDATE BOOKING ──────────────────────────────────────────────────────────
    if (action === "update_booking") {
      const userId    = await resolveUserId(req, body.userId as string | undefined);
      const bookingId = body.booking_id as string | undefined;

      if (!userId)    return json({ error: "userId required" }, 400);
      if (!bookingId) return json({ error: "booking_id required" }, 400);

      const UPDATABLE = ["title", "description", "location", "start_time", "end_time", "attendees", "status", "metadata"] as const;
      const patch: Record<string, unknown> = {};

      for (const field of UPDATABLE) {
        if (body[field] !== undefined) patch[field] = body[field];
      }

      if (Object.keys(patch).length === 0) {
        return json({ error: "No updatable fields provided" }, 400);
      }

      if (patch.status) {
        const validStatuses = ["pending", "confirmed", "cancelled"];
        if (!validStatuses.includes(patch.status as string)) {
          return json({ error: `status must be one of: ${validStatuses.join(", ")}` }, 400);
        }
      }

      const sb = adminClient();

      const { error: updateErr } = await sb
        .from("mavis_bookings")
        .update(patch)
        .eq("id", bookingId)
        .eq("user_id", userId);

      if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);

      return json({ ok: true, booking_id: bookingId, updated: Object.keys(patch) });
    }

    return json({ error: `Unknown action: ${action}. Supported: find_venue, create_booking, list_bookings, cancel_booking, update_booking` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("mavis-booking error:", msg);
    return json({ error: msg }, 500);
  }
});
