// mavis-calendly-agent
// Read scheduled meetings, event types, and invitee details from Calendly.
// Can cancel events and fetch booking links.
// Requires: CALENDLY_API_KEY (Personal Access Token from app.calendly.com/integrations/api_webhooks)
//
// Actions: get_user | list_event_types | list_events | get_event | cancel_event | list_invitees

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALENDLY_KEY = Deno.env.get("CALENDLY_API_KEY") ?? "";
const CALENDLY_API = "https://api.calendly.com";

function requireCalendly() {
  if (!CALENDLY_KEY) throw new Error("Calendly not configured. Set CALENDLY_API_KEY in Supabase secrets.");
}

async function calReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireCalendly();
  const res = await fetch(`${CALENDLY_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${CALENDLY_KEY}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.message ?? data.title ?? JSON.stringify(data).slice(0, 200);
    throw new Error(`Calendly API error (${res.status}): ${msg}`);
  }
  return data;
}

// Extract UUID from a Calendly URI like https://api.calendly.com/scheduled_events/abc-123
function uuidFromUri(uri: string): string {
  return uri.split("/").pop() ?? uri;
}

// Cache user URI within a function invocation to avoid repeated /users/me calls
let _userUri: string | null = null;
async function getUserUri(): Promise<string> {
  if (_userUri) return _userUri;
  const data = await calReq("/users/me");
  _userUri = data.resource.uri;
  return _userUri!;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {
      case "get_user": {
        const data = await calReq("/users/me");
        const u = data.resource;
        return json({
          uri:        u.uri,
          name:       u.name,
          email:      u.email,
          timezone:   u.timezone,
          avatar_url: u.avatar_url,
          scheduling_url: u.scheduling_url,
        });
      }

      case "list_event_types": {
        const userUri = await getUserUri();
        const active  = body.active !== false;
        const qs      = `user=${encodeURIComponent(userUri)}&count=100&active=${active}`;
        const data    = await calReq(`/event_types?${qs}`);

        return json({
          event_types: (data.collection as any[]).map(et => ({
            uuid:             uuidFromUri(et.uri),
            name:             et.name,
            slug:             et.slug,
            duration:         et.duration,
            kind:             et.kind,
            scheduling_url:   et.scheduling_url,
            description:      et.description_plain,
            active:           et.active,
            color:            et.color,
          })),
        });
      }

      case "list_events": {
        const userUri = await getUserUri();
        const status  = String(body.status ?? "active"); // active | canceled
        const count   = Math.min(Number(body.count ?? 20), 100);

        const qs: string[] = [`user=${encodeURIComponent(userUri)}`, `count=${count}`, `status=${status}`];
        if (body.min_start_time) qs.push(`min_start_time=${encodeURIComponent(String(body.min_start_time))}`);
        if (body.max_start_time) qs.push(`max_start_time=${encodeURIComponent(String(body.max_start_time))}`);
        if (body.sort)           qs.push(`sort=${String(body.sort)}`); // e.g. start_time:asc

        const data = await calReq(`/scheduled_events?${qs.join("&")}`);

        return json({
          events: (data.collection as any[]).map(e => ({
            uuid:            uuidFromUri(e.uri),
            name:            e.name,
            status:          e.status,
            start_time:      e.start_time,
            end_time:        e.end_time,
            location:        e.location?.join_url ?? e.location?.location ?? "",
            event_type_uuid: uuidFromUri(e.event_type),
            created_at:      e.created_at,
            uri:             e.uri,
          })),
          next_page_token: data.pagination?.next_page_token,
          count: data.collection?.length ?? 0,
        });
      }

      case "get_event": {
        const uuid = String(body.uuid ?? body.event_uuid ?? "");
        if (!uuid) return json({ error: "uuid required" }, 400);

        const data = await calReq(`/scheduled_events/${uuid}`);
        const e    = data.resource;

        // Also fetch invitees
        const inviteesData = await calReq(`/scheduled_events/${uuid}/invitees?count=50`).catch(() => ({ collection: [] }));

        return json({
          uuid,
          name:       e.name,
          status:     e.status,
          start_time: e.start_time,
          end_time:   e.end_time,
          location:   e.location?.join_url ?? e.location?.location ?? "",
          created_at: e.created_at,
          invitees:   (inviteesData.collection as any[]).map((i: any) => ({
            name:    i.name,
            email:   i.email,
            status:  i.status,
            timezone: i.timezone,
          })),
        });
      }

      case "cancel_event": {
        const uuid   = String(body.uuid ?? body.event_uuid ?? "");
        const reason = String(body.reason ?? "Canceled via MAVIS");
        if (!uuid) return json({ error: "uuid required" }, 400);

        await calReq(`/scheduled_events/${uuid}/cancellation`, "POST", { reason });
        return json({ canceled: true, uuid, reason });
      }

      case "list_invitees": {
        const uuid  = String(body.uuid ?? body.event_uuid ?? "");
        if (!uuid)  return json({ error: "uuid required" }, 400);
        const count = Math.min(Number(body.count ?? 50), 100);

        const data = await calReq(`/scheduled_events/${uuid}/invitees?count=${count}`);
        return json({
          invitees: (data.collection as any[]).map(i => ({
            name:     i.name,
            email:    i.email,
            status:   i.status,
            timezone: i.timezone,
            cancel_url:   i.cancel_url,
            reschedule_url: i.reschedule_url,
            questions_and_answers: i.questions_and_answers,
          })),
          count: data.collection?.length ?? 0,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: get_user | list_event_types | list_events | get_event | cancel_event | list_invitees`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-calendly-agent]", message);
    const status = message.includes("not configured") ? 503 : 500;
    return json({ error: message }, status);
  }
});
