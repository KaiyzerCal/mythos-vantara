// MAVIS Phone Call — Initiates an outbound AI phone call via VAPI.
// MAVIS speaks on the operator's behalf to accomplish a real-world goal.
//
// POST body:
//   { to: "+15551234567", purpose: "Reserve a table at La Piazza for tonight at 7pm for 2 people" }
//   { to: "+15551234567", purpose: "...", caller_name?: "Caliyah", first_message?: "Hi, I'm calling..." }
//
// Requires: VAPI_API_KEY, VAPI_PHONE_NUMBER_ID in Supabase secrets.
// Returns: { call_id, vapi_call_id, status }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPI_KEY = Deno.env.get("VAPI_API_KEY") ?? "";
const VAPI_PHONE_ID = Deno.env.get("VAPI_PHONE_NUMBER_ID") ?? "";
const VAPI_API = "https://api.vapi.ai";

const MAVIS_SYSTEM = `You are MAVIS — an advanced AI calling on behalf of your operator to accomplish a specific goal. You are professional, concise, and human-sounding. Never reveal you are an AI unless directly asked. If asked, acknowledge you are an AI assistant calling on behalf of your operator. Complete the stated purpose efficiently, confirm all details clearly, and close the call politely. Do not go off-topic.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!VAPI_KEY || !VAPI_PHONE_ID) {
      return new Response(
        JSON.stringify({ error: "VAPI_API_KEY or VAPI_PHONE_NUMBER_ID not configured. Set in Supabase edge function secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const toNumber    = String(body.to ?? "").trim();
    const purpose     = String(body.purpose ?? "").trim();
    const callerName  = String(body.caller_name ?? "MAVIS");
    const firstMsg    = body.first_message
      ? String(body.first_message)
      : `Hello, I'm ${callerName}, an AI assistant. I'm calling to ${purpose.toLowerCase().replace(/\.$/, "")}. Do you have a moment?`;

    if (!toNumber || !purpose) {
      return new Response(
        JSON.stringify({ error: "Provide { to: '+1...', purpose: '...' }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch operator's name for context
    const { data: profile } = await sb.from("profiles").select("inscribed_name, full_name").eq("id", user.id).single();
    const operatorName = profile?.inscribed_name ?? profile?.full_name ?? "Operator";

    // Inbound webhook URL for this Supabase project
    const webhookUrl = `${SB_URL}/functions/v1/mavis-vapi-webhook`;

    // Create call via VAPI
    const vapiRes = await fetch(`${VAPI_API}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VAPI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phoneNumberId: VAPI_PHONE_ID,
        customer: { number: toNumber },
        assistant: {
          name: callerName,
          firstMessage: firstMsg,
          model: {
            provider: "anthropic",
            model: "claude-haiku-4-5-20251001",
            messages: [{
              role: "system",
              content: `${MAVIS_SYSTEM}\n\nOPERATOR: ${operatorName}\nPURPOSE: ${purpose}\n\nComplete this purpose clearly and professionally. Once the goal is accomplished (or if it cannot be accomplished), politely end the call.`,
            }],
            temperature: 0.4,
          },
          voice: {
            provider: "11labs",
            voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel — natural, professional female
          },
          endCallMessage: "Perfect. Have a great day, goodbye.",
          endCallPhrases: ["goodbye", "bye bye", "that's all", "thank you, goodbye"],
          serverUrl: webhookUrl,
          serverUrlSecret: SB_KEY.slice(0, 32),
        },
      }),
    });

    if (!vapiRes.ok) {
      const err = await vapiRes.text();
      throw new Error(`VAPI error ${vapiRes.status}: ${err.slice(0, 300)}`);
    }

    const vapiData = await vapiRes.json();
    const vapiCallId = vapiData.id;

    // Log to DB
    const { data: callRow } = await sb.from("mavis_calls").insert({
      user_id: user.id,
      vapi_call_id: vapiCallId,
      direction: "outbound",
      to_number: toNumber,
      purpose,
      status: "initiated",
      metadata: { caller_name: callerName, vapi_response: vapiData },
    }).select("id").single();

    return new Response(
      JSON.stringify({
        call_id: callRow?.id,
        vapi_call_id: vapiCallId,
        status: "initiated",
        to: toNumber,
        purpose,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[mavis-phone-call]", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
