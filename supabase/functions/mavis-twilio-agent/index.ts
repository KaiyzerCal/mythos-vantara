// mavis-twilio-agent
// Send SMS / WhatsApp, check delivery status, list message history.
// Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
// Optional: TWILIO_WHATSAPP_NUMBER (for WhatsApp via Twilio Sandbox / WABA)
//
// Actions: send_sms | send_whatsapp | list_messages | check_message | send_bulk

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ACCOUNT_SID  = Deno.env.get("TWILIO_ACCOUNT_SID")  ?? "";
const AUTH_TOKEN   = Deno.env.get("TWILIO_AUTH_TOKEN")    ?? "";
const FROM_NUMBER  = Deno.env.get("TWILIO_FROM_NUMBER")   ?? "";
const WA_NUMBER    = Deno.env.get("TWILIO_WHATSAPP_NUMBER") ?? "";

function requireTwilio() {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    throw new Error("Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in Supabase secrets.");
  }
}

function basicAuth(): string {
  return `Basic ${btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)}`;
}

const TWILIO_BASE = () => `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}`;

async function twilioPost(path: string, params: Record<string, string>): Promise<any> {
  requireTwilio();
  const res = await fetch(`${TWILIO_BASE()}${path}`, {
    method: "POST",
    headers: {
      "Authorization": basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (data.status >= 400 || data.code) {
    throw new Error(`Twilio error (${data.status ?? data.code}): ${data.message}`);
  }
  return data;
}

async function twilioGet(path: string, qs?: Record<string, string>): Promise<any> {
  requireTwilio();
  const query = qs ? "?" + new URLSearchParams(qs).toString() : "";
  const res = await fetch(`${TWILIO_BASE()}${path}${query}`, {
    headers: { "Authorization": basicAuth() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Twilio GET error (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function e164(num: string): string {
  const clean = num.replace(/\D/g, "");
  return num.startsWith("+") ? `+${clean}` : `+1${clean}`; // default US if no +
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
      case "send_sms": {
        const to   = String(body.to ?? "");
        const text = String(body.body ?? body.text ?? body.message ?? "");
        if (!to || !text) return json({ error: "to and body required" }, 400);

        const msg = await twilioPost("/Messages.json", {
          To:   e164(to),
          From: FROM_NUMBER,
          Body: text.slice(0, 1600),
        });
        return json({ sid: msg.sid, status: msg.status, to: msg.to, from: msg.from });
      }

      case "send_whatsapp": {
        const to   = String(body.to ?? "");
        const text = String(body.body ?? body.text ?? body.message ?? "");
        if (!to || !text) return json({ error: "to and body required" }, 400);
        if (!WA_NUMBER) return json({ error: "TWILIO_WHATSAPP_NUMBER not configured" }, 503);

        const waFrom = WA_NUMBER.startsWith("whatsapp:") ? WA_NUMBER : `whatsapp:${WA_NUMBER}`;
        const waTo   = to.startsWith("whatsapp:") ? to : `whatsapp:${e164(to)}`;

        const msg = await twilioPost("/Messages.json", { To: waTo, From: waFrom, Body: text.slice(0, 4096) });
        return json({ sid: msg.sid, status: msg.status, to: msg.to });
      }

      case "send_bulk": {
        // Send the same message to multiple recipients
        const recipients = (body.recipients ?? []) as string[];
        const text       = String(body.body ?? body.text ?? body.message ?? "");
        const channel    = String(body.channel ?? "sms") as "sms" | "whatsapp";
        if (!recipients.length || !text) return json({ error: "recipients[] and body required" }, 400);

        const results = await Promise.allSettled(
          recipients.map(async (to) => {
            if (channel === "whatsapp") {
              if (!WA_NUMBER) throw new Error("TWILIO_WHATSAPP_NUMBER not configured");
              const waFrom = WA_NUMBER.startsWith("whatsapp:") ? WA_NUMBER : `whatsapp:${WA_NUMBER}`;
              const waTo   = to.startsWith("whatsapp:") ? to : `whatsapp:${e164(to)}`;
              return twilioPost("/Messages.json", { To: waTo, From: waFrom, Body: text });
            } else {
              return twilioPost("/Messages.json", { To: e164(to), From: FROM_NUMBER, Body: text });
            }
          })
        );

        return json({
          sent:   results.filter(r => r.status === "fulfilled").length,
          failed: results.filter(r => r.status === "rejected").length,
          results: results.map((r, i) =>
            r.status === "fulfilled"
              ? { to: recipients[i], sid: (r.value as any).sid, status: "sent" }
              : { to: recipients[i], error: (r.reason as Error).message, status: "failed" }
          ),
        });
      }

      case "list_messages": {
        const qs: Record<string, string> = {
          PageSize: String(Math.min(Number(body.limit ?? 20), 100)),
        };
        if (body.to)   qs.To   = e164(String(body.to));
        if (body.from) qs.From = String(body.from);
        if (body.date) qs.DateSent = String(body.date);

        const data = await twilioGet("/Messages.json", qs);
        return json({
          messages: (data.messages as any[]).map(m => ({
            sid: m.sid, from: m.from, to: m.to,
            body: m.body, status: m.status,
            date_sent: m.date_sent, direction: m.direction,
          })),
        });
      }

      case "check_message": {
        const sid = String(body.sid ?? body.message_sid ?? "");
        if (!sid) return json({ error: "sid required" }, 400);
        const msg = await twilioGet(`/Messages/${sid}.json`);
        return json({
          sid: msg.sid, from: msg.from, to: msg.to,
          body: msg.body, status: msg.status,
          date_sent: msg.date_sent, error_code: msg.error_code,
          error_message: msg.error_message,
        });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: send_sms | send_whatsapp | send_bulk | list_messages | check_message`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-twilio-agent]", message);
    const status = message.includes("not configured") ? 503 : 500;
    return json({ error: message }, status);
  }
});
