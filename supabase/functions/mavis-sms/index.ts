import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM  = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
const TWILIO_WA    = Deno.env.get("TWILIO_WHATSAPP_NUMBER") ?? "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
      return new Response(
        JSON.stringify({ error: "Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Supabase edge function secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const to      = String(body.to ?? "").trim();
    const message = String(body.message ?? "").trim();
    const channel = (body.channel === "whatsapp" ? "whatsapp" : "sms") as "sms" | "whatsapp";

    if (!to) return new Response(JSON.stringify({ error: "to is required (E.164 format)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!message) return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let toAddr   = to;
    let fromAddr = TWILIO_FROM;

    if (channel === "whatsapp") {
      if (!TWILIO_WA) {
        return new Response(
          JSON.stringify({ error: "WhatsApp not configured. Set TWILIO_WHATSAPP_NUMBER in Supabase edge function secrets." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      toAddr   = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
      fromAddr = TWILIO_WA.startsWith("whatsapp:") ? TWILIO_WA : `whatsapp:${TWILIO_WA}`;
    }

    const formBody = new URLSearchParams({ To: toAddr, From: fromAddr, Body: message });
    // Twilio requires Basic auth with SID as username and auth token as password
    const basicAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody.toString(),
      },
    );

    if (!twilioRes.ok) {
      const errText = await twilioRes.text();
      throw new Error(`Twilio error ${twilioRes.status}: ${errText.slice(0, 400)}`);
    }

    const twilioData = await twilioRes.json();
    const twilioSid  = twilioData.sid as string;
    const status     = twilioData.status as string;

    await sb.from("mavis_sms_log").insert({
      user_id:     user.id,
      to_number:   to,
      from_number: fromAddr,
      message,
      channel,
      status,
      twilio_sid:  twilioSid,
      created_at:  new Date().toISOString(),
    }).catch((e: any) => console.error("[mavis-sms] DB log error:", e.message));

    return new Response(
      JSON.stringify({ sid: twilioSid, status, to, channel }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[mavis-sms]", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
