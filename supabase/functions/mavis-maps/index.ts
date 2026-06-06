// mavis-maps — Location services: geocode, reverse, nearby POIs, routing
// All free OpenStreetMap APIs — no API keys required
// Actions: geocode | reverse | nearby | route | search

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS  = "https://overpass-api.de/api/interpreter";
const OSRM      = "https://router.project-osrm.org";
const UA        = "MAVIS/1.0 (mavis-maps edge function)";

async function getUser(authHeader: string) {
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  const { data: { user }, error } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
  return { user, error };
}

async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const res = await fetch(
    `${NOMINATIM}/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
    { headers: { "User-Agent": UA } },
  );
  const results = await res.json();
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { user, error: authErr } = await getUser(authHeader);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "geocode";

    // ── GEOCODE (address → lat/lon) ───────────────────────
    if (action === "geocode") {
      const address: string = body.address ?? "";
      if (!address) {
        return new Response(JSON.stringify({ error: "address required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(
        `${NOMINATIM}/search?q=${encodeURIComponent(address)}&format=json&limit=3&addressdetails=1`,
        { headers: { "User-Agent": UA } },
      );
      const results = await res.json();
      if (!results.length) {
        return new Response(JSON.stringify({ ok: true, found: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const r = results[0];
      return new Response(JSON.stringify({
        ok: true,
        found: true,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        display_name: r.display_name,
        address: r.address,
        type: r.type,
        alternatives: results.slice(1).map((a: any) => ({
          display_name: a.display_name,
          lat: parseFloat(a.lat),
          lon: parseFloat(a.lon),
        })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── REVERSE (lat/lon → address) ───────────────────────
    if (action === "reverse") {
      const lat = body.lat, lon = body.lon;
      if (!lat || !lon) {
        return new Response(JSON.stringify({ error: "lat and lon required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(
        `${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
        { headers: { "User-Agent": UA } },
      );
      const r = await res.json();
      return new Response(JSON.stringify({
        ok: true,
        display_name: r.display_name,
        address: r.address,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── NEARBY (find POIs near coordinates or address) ────
    if (action === "nearby") {
      let lat = body.lat ? parseFloat(body.lat) : null;
      let lon = body.lon ? parseFloat(body.lon) : null;

      if ((!lat || !lon) && body.address) {
        const coords = await geocodeAddress(body.address);
        if (!coords) {
          return new Response(JSON.stringify({ error: `Could not geocode: ${body.address}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        lat = coords.lat; lon = coords.lon;
      }
      if (!lat || !lon) {
        return new Response(JSON.stringify({ error: "lat/lon or address required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const amenity: string = body.amenity ?? "restaurant";
      const radius   = Math.min(body.radius_m ?? 500, 5000);
      const limit    = Math.min(body.limit ?? 10, 25);

      const query = `[out:json][timeout:10];node["amenity"="${amenity}"](around:${radius},${lat},${lon});out ${limit};`;
      const res = await fetch(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      const data = await res.json();

      const places = (data.elements ?? []).map((e: any) => ({
        name: e.tags?.name ?? "Unnamed",
        amenity: e.tags?.amenity,
        cuisine: e.tags?.cuisine ?? null,
        address: [
          e.tags?.["addr:housenumber"],
          e.tags?.["addr:street"],
          e.tags?.["addr:city"],
        ].filter(Boolean).join(" ") || null,
        phone: e.tags?.phone ?? null,
        website: e.tags?.website ?? null,
        lat: e.lat,
        lon: e.lon,
      }));

      return new Response(JSON.stringify({
        ok: true,
        center: { lat, lon },
        amenity,
        radius_m: radius,
        count: places.length,
        places,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── ROUTE (driving/walking/cycling directions) ────────
    if (action === "route") {
      const mode: string = body.mode ?? "driving";
      let fromLat = body.from_lat ? parseFloat(body.from_lat) : null;
      let fromLon = body.from_lon ? parseFloat(body.from_lon) : null;
      let toLat   = body.to_lat   ? parseFloat(body.to_lat)   : null;
      let toLon   = body.to_lon   ? parseFloat(body.to_lon)   : null;

      if ((!fromLat || !fromLon) && body.from) {
        const coords = await geocodeAddress(body.from);
        if (!coords) {
          return new Response(JSON.stringify({ error: `Could not geocode origin: ${body.from}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        fromLat = coords.lat; fromLon = coords.lon;
      }
      if ((!toLat || !toLon) && body.to) {
        const coords = await geocodeAddress(body.to);
        if (!coords) {
          return new Response(JSON.stringify({ error: `Could not geocode destination: ${body.to}` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        toLat = coords.lat; toLon = coords.lon;
      }

      if (!fromLat || !fromLon || !toLat || !toLon) {
        return new Response(JSON.stringify({ error: "from and to (addresses or lat/lon) required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(
        `${OSRM}/route/v1/${mode}/${fromLon},${fromLat};${toLon},${toLat}?overview=false&steps=false`,
      );
      const data = await res.json();
      if (data.code !== "Ok") throw new Error(`Routing error: ${data.message}`);

      const route = data.routes[0];
      return new Response(JSON.stringify({
        ok: true,
        mode,
        distance_km: parseFloat((route.distance / 1000).toFixed(2)),
        duration_min: Math.round(route.duration / 60),
        from: { lat: fromLat, lon: fromLon, address: body.from ?? null },
        to:   { lat: toLat,   lon: toLon,   address: body.to   ?? null },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── SEARCH (find places by name) ──────────────────────
    if (action === "search") {
      const query: string = body.query ?? "";
      if (!query) {
        return new Response(JSON.stringify({ error: "query required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: String(Math.min(body.limit ?? 5, 10)),
        addressdetails: "1",
      });

      const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: { "User-Agent": UA } });
      const results = await res.json();

      return new Response(JSON.stringify({
        ok: true,
        query,
        count: results.length,
        results: results.map((r: any) => ({
          name: r.display_name,
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          type: r.type,
          address: r.address,
        })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("mavis-maps error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
