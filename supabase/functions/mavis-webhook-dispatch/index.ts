// MAVIS Webhook Dispatch — Outbound webhook dispatcher.
// When called with an event, finds all matching registered endpoints in
// webhook_dispatch_config and POSTs the event to each of them.
// Auth: Service role only (called internally by other functions).
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function verifyServiceRole(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === SERVICE_KEY;
}

// ── HMAC-SHA256 signature ─────────────────────────────────────────────────────

async function buildHmacSignature(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signedBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// ── Webhook config row type ───────────────────────────────────────────────────

interface WebhookConfig {
  id: string;
  user_id: string;
  name: string;
  endpoint_url: string;
  event_types: string[];
  secret: string | null;
  active: boolean;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!verifyServiceRole(req)) {
    return json({ error: "Service role authorization required" }, 403);
  }

  let body: { event_type?: string; user_id?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const eventType = String(body.event_type ?? "").trim();
  const userId = String(body.user_id ?? "").trim();
  const payload = body.payload ?? {};

  if (!eventType) return json({ error: "event_type is required" }, 400);
  if (!userId) return json({ error: "user_id is required" }, 400);

  // Query matching webhook configs
  // Match configs where event_types contains the specific event OR the wildcard '*'
  const { data: configs, error: queryErr } = await adminSb
    .from("webhook_dispatch_config")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true);

  if (queryErr) {
    console.error("[mavis-webhook-dispatch] Config query error:", queryErr);
    return json({ error: `DB query failed: ${queryErr.message}` }, 500);
  }

  // Filter in JS to check array containment (Supabase JS doesn't support @> for array columns directly)
  const matching = (configs as WebhookConfig[]).filter(
    (c) => c.event_types.includes(eventType) || c.event_types.includes("*"),
  );

  let dispatched = 0;
  let failed = 0;

  for (const config of matching) {
    const outboundPayload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    };
    const bodyStr = JSON.stringify(outboundPayload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-MAVIS-Event": eventType,
      "User-Agent": "MAVIS-Webhook-Dispatch/1.0",
    };

    // Add HMAC signature if secret is configured
    if (config.secret) {
      const signature = await buildHmacSignature(config.secret, bodyStr);
      headers["X-MAVIS-Signature"] = signature;
    }

    let statusCode = 0;
    let ok = false;
    let errorMsg: string | null = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(config.endpoint_url, {
        method: "POST",
        headers,
        body: bodyStr,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      statusCode = res.status;
      ok = res.ok;
      if (!ok) {
        const respText = await res.text().catch(() => "");
        errorMsg = `HTTP ${statusCode}: ${respText.slice(0, 200)}`;
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      statusCode = 0;
      ok = false;
    }

    // Log the dispatch attempt
    await adminSb.from("webhook_dispatch_log").insert({
      config_id: config.id,
      user_id: userId,
      event_type: eventType,
      payload: outboundPayload,
      status_code: statusCode,
      ok,
      error: errorMsg,
    });

    if (ok) {
      dispatched++;
    } else {
      failed++;
      console.warn(`[mavis-webhook-dispatch] Delivery failed to ${config.endpoint_url}: ${errorMsg}`);
    }
  }

  return json({ dispatched, failed, total_matched: matching.length });
});
