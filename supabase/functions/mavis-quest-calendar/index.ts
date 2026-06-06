import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const GCAL_BASE = "https://www.googleapis.com/calendar/v3/calendars";

async function getIntegrationValues(
  sb: any,
  uid: string,
  keyNames: string[]
): Promise<Record<string, string>> {
  const { data, error } = await sb
    .from("mavis_user_integrations")
    .select("key_name, key_value")
    .eq("user_id", uid)
    .eq("provider", "google_calendar")
    .in("key_name", keyNames);

  if (error || !data) return {};
  return Object.fromEntries(data.map((r: any) => [r.key_name, r.key_value]));
}

async function pushQuests(sb: any, uid: string): Promise<Response> {
  const integrations = await getIntegrationValues(sb, uid, ["access_token", "calendar_id"]);
  const accessToken = integrations["access_token"];
  const calendarId = integrations["calendar_id"];

  if (!accessToken || !calendarId) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "Google Calendar not configured in Integrations" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch active quests with non-null deadlines
  const { data: quests, error: questError } = await sb
    .from("quests")
    .select("id, title, description, deadline")
    .eq("user_id", uid)
    .eq("status", "active")
    .not("deadline", "is", null);

  if (questError) {
    console.error("Error fetching quests:", questError);
    return new Response(JSON.stringify({ error: questError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let pushed = 0;
  let failed = 0;

  for (const quest of quests ?? []) {
    const eventBody = {
      summary: `[MAVIS] ${quest.title}`,
      description: quest.description || "",
      start: { date: quest.deadline },
      end: { date: quest.deadline },
      colorId: "9",
    };

    const response = await fetch(
      `${GCAL_BASE}/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      }
    );

    if (response.status === 401) {
      return new Response(
        JSON.stringify({ error: "Google token expired — re-authorize in Integrations" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!response.ok) {
      console.error(`Failed to create event for quest ${quest.id}:`, response.status);
      failed++;
    } else {
      pushed++;
    }
  }

  return new Response(
    JSON.stringify({ pushed, failed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function pullCalendar(sb: any, uid: string): Promise<Response> {
  const integrations = await getIntegrationValues(sb, uid, ["access_token", "calendar_id"]);
  const accessToken = integrations["access_token"];
  const calendarId = integrations["calendar_id"];

  if (!accessToken || !calendarId) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "Google Calendar not configured in Integrations" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const timeMin = now.toISOString();
  const timeMax = in30Days.toISOString();

  const url = `${GCAL_BASE}/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;

  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });

  if (response.status === 401) {
    return new Response(
      JSON.stringify({ error: "Google token expired — re-authorize in Integrations" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!response.ok) {
    const errText = await response.text();
    return new Response(JSON.stringify({ error: `Google Calendar API error: ${errText}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gcalData = await response.json();
  const events = gcalData.items ?? [];

  let upserted = 0;
  let failed = 0;

  for (const event of events) {
    const startDate = event.start?.date ?? event.start?.dateTime ?? null;
    const endDate = event.end?.date ?? event.end?.dateTime ?? null;

    const record = {
      user_id: uid,
      gcal_event_id: event.id,
      title: event.summary ?? "(No title)",
      description: event.description ?? "",
      start_date: startDate,
      end_date: endDate,
      source: "google_calendar",
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await sb
      .from("calendar_events")
      .upsert(record, { onConflict: "user_id,gcal_event_id" });

    if (upsertError) {
      console.error("Upsert error for event", event.id, upsertError);
      failed++;
    } else {
      upserted++;
    }
  }

  return new Response(
    JSON.stringify({ pulled: upserted, failed }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const action: string = body.action;

    if (!["push", "pull", "sync"].includes(action)) {
      return new Response(JSON.stringify({ error: "action must be push, pull, or sync" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uid: string = body.user_id ?? Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? "";

    if (!uid) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "push") {
      return await pushQuests(sb, uid);
    }

    if (action === "pull") {
      return await pullCalendar(sb, uid);
    }

    // sync = push then pull
    if (action === "sync") {
      const pushResponse = await pushQuests(sb, uid);
      const pushResult = await pushResponse.json();

      // If push hit an auth error, surface it immediately
      if (pushResult.error || pushResult.skipped) {
        return new Response(JSON.stringify({ push: pushResult }), {
          status: pushResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pullResponse = await pullCalendar(sb, uid);
      const pullResult = await pullResponse.json();

      return new Response(
        JSON.stringify({ push: pushResult, pull: pullResult }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Unreachable, but satisfies TypeScript
    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
