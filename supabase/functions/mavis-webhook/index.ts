// MAVIS Webhook — External webhook receiver for Zapier, Make, n8n, and other automation tools.
// Auth: Optional HMAC-SHA256 signature via X-Webhook-Signature header.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// HMAC-SHA256 signature verification
async function verifyHmacSignature(rawBody: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signedBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(rawBody),
    );
    const hex = Array.from(new Uint8Array(signedBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const expected = `sha256=${hex}`;
    return expected === signature;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Read raw body for signature verification
  const rawBody = await req.text();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const userId = body.user_id ? String(body.user_id) : null;
  if (!userId) {
    return json({ error: "user_id is required" }, 400);
  }

  // Signature verification
  const sigHeader = req.headers.get("X-Webhook-Signature") ?? req.headers.get("x-webhook-signature") ?? "";
  let verified = false;

  if (WEBHOOK_SECRET) {
    if (sigHeader) {
      const valid = await verifyHmacSignature(rawBody, sigHeader);
      if (!valid) {
        return json({ error: "Invalid signature" }, 401);
      }
      verified = true;
    } else {
      // No signature header but secret is set — accept but log unverified
      console.warn("[mavis-webhook] Request received without X-Webhook-Signature (WEBHOOK_SECRET is set). Accepting as unverified.");
      verified = false;
    }
  } else {
    // No secret configured — accept all
    verified = false;
  }

  const eventType = String(body.event_type ?? "unknown");
  const source = String(body.source ?? "unknown");
  const data = body.data ?? {};
  const actions: Array<{ type: string; params: Record<string, unknown> }> = Array.isArray(body.actions) ? body.actions : [];

  // Insert webhook_events row
  const { data: webhookRow, error: insertErr } = await adminSb
    .from("webhook_events")
    .insert({
      event_type: eventType,
      source,
      user_id: userId,
      data,
      actions_executed: [],
      verified,
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("[mavis-webhook] webhook_events insert error:", insertErr);
    return json({ error: `Failed to log webhook event: ${insertErr.message}` }, 500);
  }

  const eventId = webhookRow?.id;
  let actionsTriggered = 0;

  // Dispatch actions if provided
  if (actions.length > 0) {
    try {
      const actionsRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ actions, userId }),
      });

      let actionsResult: unknown = null;
      try {
        actionsResult = await actionsRes.json();
      } catch {
        actionsResult = { status: actionsRes.status };
      }

      // Update webhook_events row with actions_executed results
      await adminSb
        .from("webhook_events")
        .update({ actions_executed: actionsResult })
        .eq("id", eventId);

      actionsTriggered = actions.length;
    } catch (actionErr) {
      console.error("[mavis-webhook] mavis-actions call failed:", actionErr);
      await adminSb
        .from("webhook_events")
        .update({ actions_executed: [{ error: String(actionErr) }] })
        .eq("id", eventId);
    }
  }

  return json({
    received: true,
    event_id: eventId,
    actions_triggered: actionsTriggered,
  });
});
