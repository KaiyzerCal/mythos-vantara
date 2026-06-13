// mavis-receptionist-inbound
// VAPI inbound call webhook — handles assistant-request, function-call, end-of-call-report
// verify_jwt = false (VAPI sends no Supabase JWT)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-vapi-secret",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const VAPI_KEY = Deno.env.get("VAPI_API_KEY") ?? "";
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM = Deno.env.get("TWILIO_PHONE_NUMBER") ?? "";

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Business hours check ──────────────────────────────────────────────────────

function isBusinessOpen(hours: Record<string, { open: string; close: string } | null>, timezone: string): boolean {
  try {
    const now = new Date();
    const localStr = now.toLocaleString("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    // Parse day and time
    const parts = localStr.split(", ");
    const dayMap: Record<string, string> = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };
    const dayKey = dayMap[parts[0]] ?? "mon";
    const timeStr = parts[1]; // "09:30"
    const dayHours = hours[dayKey];
    if (!dayHours) return false;
    return timeStr >= dayHours.open && timeStr < dayHours.close;
  } catch {
    return true; // default open
  }
}

// ── Tool executors ────────────────────────────────────────────────────────────

async function checkAvailability(businessId: string, date: string, duration = 30): Promise<string> {
  // Look up Google Calendar integration for this business's user
  const { data: biz } = await sb().from("receptionist_businesses").select("user_id").eq("id", businessId).maybeSingle();
  if (!biz) return "Unable to check availability at this time.";

  const { data: integration } = await sb()
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", biz.user_id)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (!integration?.config?.access_token) {
    return `I'd be happy to check availability for ${date}. Our team will confirm the appointment shortly.`;
  }

  try {
    const start = new Date(date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${integration.config.access_token}` } }
    );
    if (!res.ok) return `I can check availability for ${date}. Our team will confirm shortly.`;
    const cal = await res.json();
    const events = cal.items ?? [];
    const busySlots = events.map((e: any) => `${e.start?.dateTime?.slice(11, 16)} - ${e.end?.dateTime?.slice(11, 16)}`).join(", ");
    if (!busySlots) return `${date} looks open! We have slots available throughout the day. What time works best for you?`;
    return `On ${date}, we're busy at: ${busySlots}. The rest of the day is available. What time would you prefer?`;
  } catch {
    return `I can check availability for ${date}. Our team will confirm shortly.`;
  }
}

async function bookAppointment(
  businessId: string,
  callerName: string,
  callerNumber: string,
  datetime: string,
  notes: string,
  duration = 60
): Promise<string> {
  const { data: biz } = await sb().from("receptionist_businesses").select("user_id, name").eq("id", businessId).maybeSingle();
  if (!biz) return "I wasn't able to book the appointment. Please call back and we'll assist you.";

  const { data: integration } = await sb()
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", biz.user_id)
    .eq("provider", "google_calendar")
    .maybeSingle();

  const start = new Date(datetime);
  const end = new Date(start.getTime() + duration * 60 * 1000);

  if (integration?.config?.access_token) {
    try {
      await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${integration.config.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: `Appointment: ${callerName}`,
          description: `Phone: ${callerNumber}\nNotes: ${notes}`,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
        }),
      });
    } catch { /* non-fatal */ }
  }

  // Send confirmation SMS via Twilio
  if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && callerNumber) {
    try {
      const smsBody = `Hi ${callerName}! Your appointment at ${biz.name} is confirmed for ${start.toLocaleString()}. Reply STOP to opt out.`;
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
        },
        body: new URLSearchParams({ To: callerNumber, From: TWILIO_FROM, Body: smsBody }),
      });
    } catch { /* non-fatal */ }
  }

  return `Perfect! I've booked your appointment for ${start.toLocaleString()}. You'll receive a confirmation text shortly. Is there anything else I can help you with?`;
}

async function takeMessage(
  businessId: string,
  userId: string,
  callId: string | null,
  callerName: string,
  callerNumber: string,
  message: string,
  urgency = "normal"
): Promise<string> {
  await sb().from("receptionist_messages").insert({
    business_id: businessId,
    user_id: userId,
    call_id: callId,
    caller_number: callerNumber,
    caller_name: callerName,
    message,
    urgency,
  });
  return `I've recorded your message, ${callerName}. Someone from our team will get back to you as soon as possible. Is there anything else I can help you with?`;
}

async function transferCall(destinationNumber: string, callId: string): Promise<string> {
  if (!VAPI_KEY || !callId) return "I'll transfer you now. Please hold.";
  try {
    await fetch(`https://api.vapi.ai/call/${callId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${VAPI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ transfer: { destination: { type: "number", number: destinationNumber } } }),
    });
    return "I'm transferring you now. Please hold while I connect you.";
  } catch {
    return `I'll connect you to ${destinationNumber}. Please hold.`;
  }
}

// ── Build VAPI assistant config for a business ────────────────────────────────

function buildAssistantConfig(biz: any, isOpen: boolean): object {
  const afterHoursGreeting = `Thank you for calling ${biz.name}. We are currently closed. I can take a message and someone will get back to you during business hours. How can I help?`;
  const openGreeting = biz.greeting || `Thank you for calling ${biz.name}. How can I help you today?`;

  return {
    name: `MAVIS Receptionist — ${biz.name}`,
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "system",
          content: [
            `You are a professional AI receptionist for ${biz.name}, a ${biz.industry} business.`,
            biz.description ? `About the business: ${biz.description}` : "",
            isOpen
              ? "The business is currently OPEN. You can book appointments and check availability."
              : "The business is currently CLOSED. You can only take messages.",
            "",
            "Your personality: Warm, professional, efficient. You are concise and focused.",
            "Always confirm the caller's name and phone number when taking messages or booking appointments.",
            "If asked something you don't know, offer to take a message.",
            "",
            "Available tools:",
            "- check_availability: Check calendar availability for a date",
            "- book_appointment: Book an appointment with name, phone, datetime, and notes",
            "- take_message: Record a message from the caller",
            "- transfer_call: Transfer to a human agent",
          ].filter(Boolean).join("\n"),
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "check_availability",
            description: "Check calendar availability for a given date",
            parameters: {
              type: "object",
              properties: {
                date: { type: "string", description: "Date to check (e.g. 2024-12-15)" },
                duration: { type: "number", description: "Appointment duration in minutes (default 30)" },
              },
              required: ["date"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "book_appointment",
            description: "Book an appointment for the caller",
            parameters: {
              type: "object",
              properties: {
                caller_name: { type: "string", description: "Caller's full name" },
                caller_number: { type: "string", description: "Caller's phone number" },
                datetime: { type: "string", description: "ISO 8601 datetime for the appointment" },
                notes: { type: "string", description: "Any notes or reason for the appointment" },
                duration: { type: "number", description: "Duration in minutes (default 60)" },
              },
              required: ["caller_name", "caller_number", "datetime"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "take_message",
            description: "Record a message from the caller to pass to the business",
            parameters: {
              type: "object",
              properties: {
                caller_name: { type: "string", description: "Caller's name" },
                caller_number: { type: "string", description: "Caller's phone number" },
                message: { type: "string", description: "The message content" },
                urgency: { type: "string", enum: ["low", "normal", "high", "urgent"], description: "Message urgency" },
              },
              required: ["caller_name", "caller_number", "message"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "transfer_call",
            description: "Transfer the call to a human agent or specific number",
            parameters: {
              type: "object",
              properties: {
                destination: { type: "string", description: "Phone number to transfer to (E.164 format)" },
              },
              required: ["destination"],
            },
          },
        },
      ],
      temperature: 0.4,
    },
    voice: {
      provider: "11labs",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      stability: 0.5,
      similarityBoost: 0.75,
    },
    firstMessage: isOpen ? openGreeting : afterHoursGreeting,
    recordingEnabled: true,
    endCallFunctionEnabled: true,
    maxDurationSeconds: 600,
    silenceTimeoutSeconds: 20,
    responseDelaySeconds: 0.5,
    endCallMessage: "Thank you for calling. Have a great day! Goodbye.",
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: "en",
    },
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const message = body.message ?? body;
  const type = message?.type ?? body?.type;

  // ── assistant-request ──────────────────────────────────────────────────────
  if (type === "assistant-request") {
    const vapiPhoneNumberId = message?.call?.phoneNumberId ?? message?.phoneNumberId ?? "";

    // Look up which business owns this phone number
    const { data: phoneRow } = await sb()
      .from("receptionist_phone_numbers")
      .select("business_id, user_id")
      .eq("vapi_phone_number_id", vapiPhoneNumberId)
      .eq("is_active", true)
      .maybeSingle();

    if (!phoneRow) {
      // Fallback generic assistant
      return json({
        assistant: {
          name: "MAVIS Receptionist",
          model: {
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            messages: [{ role: "system", content: "You are a professional AI receptionist. Take messages and be helpful." }],
            temperature: 0.4,
          },
          voice: { provider: "11labs", voiceId: "21m00Tcm4TlvDq8ikWAM" },
          firstMessage: "Thank you for calling. How can I help you today?",
          maxDurationSeconds: 300,
        },
      });
    }

    const { data: biz } = await sb()
      .from("receptionist_businesses")
      .select("*")
      .eq("id", phoneRow.business_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!biz) {
      return json({ error: "Business not found" }, 404);
    }

    const isOpen = isBusinessOpen(biz.hours ?? {}, biz.timezone ?? "America/New_York");
    const assistantConfig = buildAssistantConfig(biz, isOpen);

    return json({ assistant: assistantConfig });
  }

  // ── function-call (real-time tool execution during live call) ──────────────
  if (type === "function-call") {
    const functionCall = message?.functionCall ?? body?.functionCall;
    const toolName = functionCall?.name ?? "";
    const params = functionCall?.parameters ?? {};
    const callId = message?.call?.id ?? null;
    const vapiPhoneNumberId = message?.call?.phoneNumberId ?? "";

    // Resolve businessId and userId from phone number
    const { data: phoneRow } = await sb()
      .from("receptionist_phone_numbers")
      .select("business_id, user_id")
      .eq("vapi_phone_number_id", vapiPhoneNumberId)
      .maybeSingle();

    const businessId = phoneRow?.business_id ?? "";
    const userId = phoneRow?.user_id ?? "";

    let result = "I'm sorry, I was unable to complete that action.";

    try {
      switch (toolName) {
        case "check_availability":
          result = await checkAvailability(businessId, String(params.date ?? ""), Number(params.duration ?? 30));
          break;
        case "book_appointment":
          result = await bookAppointment(
            businessId,
            String(params.caller_name ?? ""),
            String(params.caller_number ?? ""),
            String(params.datetime ?? ""),
            String(params.notes ?? ""),
            Number(params.duration ?? 60)
          );
          break;
        case "take_message":
          result = await takeMessage(
            businessId,
            userId,
            callId,
            String(params.caller_name ?? ""),
            String(params.caller_number ?? ""),
            String(params.message ?? ""),
            String(params.urgency ?? "normal")
          );
          break;
        case "transfer_call":
          result = await transferCall(String(params.destination ?? ""), callId ?? "");
          break;
        default:
          result = "I'm not sure how to help with that. Can I take a message?";
      }
    } catch (err: any) {
      console.error("[receptionist-inbound] tool error:", err.message);
      result = "I encountered an issue completing that request. Can I take a message instead?";
    }

    return json({ result });
  }

  // ── end-of-call-report ─────────────────────────────────────────────────────
  if (type === "end-of-call-report" || type === "call.ended") {
    const call = message?.call ?? body?.call ?? {};
    const vapiCallId = call?.id ?? "";
    const vapiPhoneNumberId = call?.phoneNumberId ?? "";
    const transcript = message?.transcript ?? call?.transcript ?? "";
    const duration = Math.round((call?.endedAt && call?.startedAt)
      ? (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
      : 0);
    const recordingUrl = call?.recordingUrl ?? message?.recordingUrl ?? "";

    // Resolve business
    const { data: phoneRow } = await sb()
      .from("receptionist_phone_numbers")
      .select("business_id, user_id")
      .eq("vapi_phone_number_id", vapiPhoneNumberId)
      .maybeSingle();

    if (phoneRow) {
      const { data: callRow } = await sb()
        .from("receptionist_calls")
        .insert({
          business_id: phoneRow.business_id,
          user_id: phoneRow.user_id,
          vapi_call_id: vapiCallId,
          caller_number: call?.customer?.number ?? "",
          duration_seconds: duration,
          status: "completed",
          transcript,
          recording_url: recordingUrl,
        })
        .select("id")
        .single();

      // Check if a message was taken — send follow-up SMS
      if (callRow?.id && TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
        const { data: msgs } = await sb()
          .from("receptionist_messages")
          .select("id")
          .eq("call_id", callRow.id)
          .limit(1);

        if (msgs && msgs.length > 0) {
          const callerNum = call?.customer?.number;
          if (callerNum) {
            try {
              const { data: biz } = await sb().from("receptionist_businesses").select("name").eq("id", phoneRow.business_id).maybeSingle();
              const smsBody = `Hi! This is a follow-up from ${biz?.name ?? "us"}. We received your message and will get back to you shortly. Thank you!`;
              await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
                },
                body: new URLSearchParams({ To: callerNum, From: TWILIO_FROM, Body: smsBody }),
              });
              await sb().from("receptionist_calls").update({ follow_up_sent: true }).eq("id", callRow.id);
            } catch { /* non-fatal */ }
          }
        }
      }
    }

    return json({ received: true });
  }

  // Unknown event type — return 200 to avoid VAPI retries
  return json({ received: true });
});
