// mavis-webhook-calendar
// Inbound webhook endpoint: receives any payload containing natural language text,
// parses it into a structured Google Calendar event via Claude, and creates the event.
//
// Mirrors Make.com: CustomWebhook → AI parse → createAnEvent → WebhookRespond.
// Designed for external tools (Pickaxe, Zapier, other AI agents, etc.) to schedule
// events in MAVIS without needing full API access.
//
// Auth: X-MAVIS-Key header OR api_key body param (matches MAVIS_WEBHOOK_CALENDAR_SECRET)
//       For internal calls: Authorization: Bearer <service-role-key> + userId in body
//
// Text extraction: looks for body.text | body.message | body.content | body.description
//                  | body.input — or stringifies the entire payload as fallback.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mavis-key",
};

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SRK        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("MAVIS_WEBHOOK_CALENDAR_SECRET") ?? "";
const OPERATOR_ID   = Deno.env.get("MAVIS_OPERATOR_MAIN_ID") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body       = await req.json().catch(() => ({}));
    const adminSb    = createClient(SB_URL, SB_SRK);
    const authHeader = req.headers.get("Authorization") ?? "";
    const webhookKey = req.headers.get("X-MAVIS-Key") ?? String(body.api_key ?? "");

    let uid: string;

    if (authHeader === `Bearer ${SB_SRK}`) {
      // Internal service-role call
      uid = String(body.userId ?? body.user_id ?? OPERATOR_ID).trim();
      if (!uid) return json({ error: "userId required" }, 400);
    } else if (WEBHOOK_SECRET && webhookKey === WEBHOOK_SECRET) {
      // External tool authenticated via shared secret
      uid = String(body.user_id ?? body.userId ?? OPERATOR_ID).trim();
      if (!uid) return json({ error: "user_id required in payload" }, 400);
    } else if (authHeader.startsWith("Bearer ")) {
      const { data: { user }, error } = await adminSb.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      uid = user.id;
    } else if (!WEBHOOK_SECRET) {
      // No secret configured — fall back to operator ID for convenience (dev mode)
      if (!OPERATOR_ID) return json({ error: "Unauthorized — configure MAVIS_WEBHOOK_CALENDAR_SECRET" }, 401);
      uid = OPERATOR_ID;
    } else {
      return json({ error: "Unauthorized — provide X-MAVIS-Key header" }, 401);
    }

    // Extract natural language text from the payload
    const text: string =
      String(
        body.text ??
        body.message ??
        body.content ??
        body.description ??
        body.input ??
        body.event ??
        ""
      ).trim() ||
      JSON.stringify(body);  // fallback: stringify the entire payload

    const timezone    = String(body.timezone ?? body.tz ?? "America/New_York");
    const calendarId  = String(body.calendar_id ?? body.calendarId ?? "primary");
    const createMeet  = Boolean(body.create_meet ?? false);
    const defaultTitle = String(body.default_title ?? "MAVIS Scheduled Event");

    // Delegate to mavis-google-agent schedule_from_text
    const res = await fetch(`${SB_URL}/functions/v1/mavis-google-agent`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${SB_SRK}`,
      },
      body: JSON.stringify({
        userId:        uid,
        action:        "schedule_from_text",
        text,
        timezone,
        calendar_id:   calendarId,
        create_meet:   createMeet,
        default_title: defaultTitle,
      }),
      signal: AbortSignal.timeout(45000),
    });

    const result = await res.json().catch(() => ({ error: "upstream parse error" }));

    if (!res.ok) {
      return json({ success: false, error: (result as any).error ?? `google-agent returned ${res.status}` }, 502);
    }

    // Log the inbound webhook
    await adminSb.from("mavis_memory").insert({
      user_id:          uid,
      role:             "system",
      content:          `[WEBHOOK_CALENDAR] Inbound webhook created event "${(result as any).title ?? "?"}" from: ${text.slice(0, 200)}`,
      importance_score: 4,
      tags:             ["webhook", "calendar", "webhook_calendar", "inbound"],
    }).catch(() => {});

    return json({
      success:     true,
      event_id:    (result as any).event_id,
      title:       (result as any).title,
      start:       (result as any).start,
      end:         (result as any).end,
      location:    (result as any).location,
      link:        (result as any).link,
      meet_link:   (result as any).meet_link,
      parsed:      (result as any).parsed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-webhook-calendar]", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
