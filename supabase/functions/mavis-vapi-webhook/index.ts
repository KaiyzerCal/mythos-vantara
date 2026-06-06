// MAVIS VAPI Webhook — receives real-time events from VAPI for all phone calls.
// Events: call-started, transcript, end-of-call-report, call-ended, status-update
//
// No JWT auth — VAPI sends no Supabase token. Secured by x-vapi-secret header check.
// Set VAPI_WEBHOOK_SECRET = first 32 chars of SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPECTED_SECRET = SB_KEY.slice(0, 32);

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

serve(async (req) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  // Validate webhook secret
  const secret = req.headers.get("x-vapi-secret") ?? "";
  if (secret !== EXPECTED_SECRET) {
    console.warn("[mavis-vapi-webhook] Invalid secret");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const { message } = payload;
  if (!message?.type) return new Response("OK", { status: 200 });

  const vapiCallId = message.call?.id ?? payload.call?.id ?? "";

  try {
    switch (message.type) {
      case "status-update": {
        const status = message.status; // queued, ringing, in-progress
        if (vapiCallId && status) {
          await sb.from("mavis_calls")
            .update({ status, updated_at: new Date().toISOString() })
            .eq("vapi_call_id", vapiCallId);
        }
        break;
      }

      case "transcript": {
        if (!vapiCallId) break;
        // Append transcript turn
        const { data: row } = await sb.from("mavis_calls")
          .select("transcript")
          .eq("vapi_call_id", vapiCallId)
          .single();

        const existing = (row?.transcript as any[]) ?? [];
        existing.push({
          role: message.role,
          text: message.transcript,
          timestamp: new Date().toISOString(),
        });

        await sb.from("mavis_calls")
          .update({ transcript: existing, updated_at: new Date().toISOString() })
          .eq("vapi_call_id", vapiCallId);
        break;
      }

      case "end-of-call-report": {
        if (!vapiCallId) break;
        const report = message;
        const durationSec = report.call?.duration ?? 0;
        const costCents   = Math.round((report.cost ?? 0) * 100);
        const summary     = report.summary ?? "";
        const outcome     = extractOutcome(summary);
        const recordingUrl = report.call?.recordingUrl ?? null;

        // Full transcript from report (more complete than incremental)
        const transcript = (report.transcript ?? []).map((t: any) => ({
          role: t.role,
          text: t.message,
          timestamp: t.time ?? new Date().toISOString(),
        }));

        await sb.from("mavis_calls").update({
          status: "ended",
          duration_seconds: durationSec,
          cost_cents: costCents,
          summary,
          outcome,
          recording_url: recordingUrl,
          transcript: transcript.length ? transcript : undefined,
          ended_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("vapi_call_id", vapiCallId);

        // Store outcome in MAVIS memory if meaningful
        if (summary && vapiCallId) {
          const { data: callRow } = await sb.from("mavis_calls")
            .select("user_id, purpose, to_number")
            .eq("vapi_call_id", vapiCallId)
            .single();

          if (callRow?.user_id) {
            await sb.from("mavis_memory").insert({
              user_id: callRow.user_id,
              role: "assistant",
              content: `[PHONE CALL COMPLETED]\nCalled: ${callRow.to_number}\nPurpose: ${callRow.purpose}\nOutcome: ${outcome || summary}\nDuration: ${durationSec}s`,
              importance_score: 7,
              tags: ["phone_call", "completed_action"],
            });
          }
        }
        break;
      }

      case "call-ended": {
        if (!vapiCallId) break;
        await sb.from("mavis_calls").update({
          status: "ended",
          ended_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("vapi_call_id", vapiCallId).eq("status", "initiated");
        break;
      }

      case "hang": {
        // Call hung up by one party
        if (vapiCallId) {
          await sb.from("mavis_calls").update({
            status: "ended",
            ended_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("vapi_call_id", vapiCallId);
        }
        break;
      }

      default:
        break;
    }
  } catch (e: any) {
    console.error("[mavis-vapi-webhook]", message.type, e.message);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

function extractOutcome(summary: string): string {
  if (!summary) return "";
  // Look for outcome-like sentences
  const lines = summary.split(/[.!?\n]/).map(s => s.trim()).filter(Boolean);
  const outcomeKeywords = ["reserved", "booked", "confirmed", "scheduled", "arranged", "completed", "successful", "failed", "unavailable", "declined"];
  const match = lines.find(l => outcomeKeywords.some(k => l.toLowerCase().includes(k)));
  return match ?? lines[0] ?? "";
}
