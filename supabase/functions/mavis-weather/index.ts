import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSb = createClient(supabaseUrl, serviceRoleKey);

    // Auth → uid (Bearer or TELEGRAM_OPERATOR_USER_ID fallback)
    let uid: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const userSb = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userSb.auth.getUser();
      uid = user?.id ?? null;
    }
    if (!uid) {
      uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
    }
    if (!uid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    let body: { location?: string } = {};
    try {
      body = await req.json();
    } catch (_) { /* no body */ }

    // Read location: check mavis_user_integrations first
    let location = body.location ?? "New York,US";
    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", uid)
      .eq("provider", "weather")
      .single();
    if (integration?.config?.location) {
      location = integration.config.location;
    }

    const key = Deno.env.get("OPENWEATHERMAP_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "OPENWEATHERMAP_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch current weather and forecast in parallel
    const [weatherRes, forecastRes] = await Promise.all([
      fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=imperial&appid=${key}`,
        { signal: AbortSignal.timeout(10000) },
      ),
      fetch(
        `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(location)}&units=imperial&cnt=4&appid=${key}`,
        { signal: AbortSignal.timeout(10000) },
      ),
    ]);

    if (!weatherRes.ok) {
      const err = await weatherRes.text();
      return new Response(JSON.stringify({ error: "Weather API error", detail: err }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!forecastRes.ok) {
      const err = await forecastRes.text();
      return new Response(JSON.stringify({ error: "Forecast API error", detail: err }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const w = await weatherRes.json();
    const f = await forecastRes.json();

    const current = {
      temp: Math.round(w.main.temp),
      feels_like: Math.round(w.main.feels_like),
      humidity: w.main.humidity,
      description: w.weather[0]?.description ?? "",
      wind_mph: Math.round(w.wind.speed),
      location: w.name,
    };

    const forecast = f.list.map((item: any) => ({
      time: new Date(item.dt * 1000).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }),
      temp: Math.round(item.main.temp),
      description: item.weather[0]?.description ?? "",
    }));

    // Upsert into mavis_notes (one note per day, updated)
    await adminSb.from("mavis_notes").upsert({
      user_id: uid,
      title: `Weather — ${new Date().toISOString().slice(0, 10)}`,
      content: `${current.location}: ${current.temp}°F, ${current.description}. Humidity ${current.humidity}%. Wind ${current.wind_mph}mph. Forecast: ${forecast.map((f: any) => `${f.time} ${f.temp}°F ${f.description}`).join(", ")}`,
      tags: ["weather", "intel", "auto"],
      properties: {
        source: "openweathermap",
        current,
        forecast,
        updated_at: new Date().toISOString(),
      },
    }, { onConflict: "user_id,title" });

    return new Response(JSON.stringify({ current, forecast }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
