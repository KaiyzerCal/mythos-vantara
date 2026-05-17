import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PushInput {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface DevicePushToken {
  id: string;
  user_id: string;
  token: string;
  platform: "ios" | "android" | "web";
  device_name: string | null;
  active: boolean;
  error_count: number;
}

async function buildApnsJwt(keyId: string, teamId: string, authKey: string): Promise<string> {
  // Import the APNS auth key (P8 format — ES256)
  const pemBody = authKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = { alg: "ES256", kid: keyId };
  const payload = { iss: teamId, iat: Math.floor(Date.now() / 1000) };

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signingBytes = new TextEncoder().encode(signingInput);

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    signingBytes,
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${sigB64}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Parse & validate input ───────────────────────────────────────────────
    const input: PushInput = await req.json();
    if (!input.user_id || !input.title || !input.body) {
      return new Response(
        JSON.stringify({ error: "user_id, title, and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Supabase client ──────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Env vars for push providers ──────────────────────────────────────────
    const FCM_SERVER_KEY = Deno.env.get("FCM_SERVER_KEY");
    const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID");
    const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID");
    const APNS_AUTH_KEY = Deno.env.get("APNS_AUTH_KEY");
    const apnsConfigured = !!(APNS_KEY_ID && APNS_TEAM_ID && APNS_AUTH_KEY);

    // ── Fetch active device tokens for user ──────────────────────────────────
    const { data: tokens, error: fetchError } = await supabase
      .from("device_push_tokens")
      .select("id, user_id, token, platform, device_name, active, error_count")
      .eq("user_id", input.user_id)
      .eq("active", true);

    if (fetchError) {
      console.error("Failed to fetch device tokens:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch device tokens" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, skipped: 0, reason: "No active tokens found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // Pre-build APNS JWT once if needed (valid for up to 60 min)
    let apnsJwt: string | null = null;
    const iosTokens = (tokens as DevicePushToken[]).filter((t) => t.platform === "ios");
    if (iosTokens.length > 0 && apnsConfigured) {
      try {
        apnsJwt = await buildApnsJwt(APNS_KEY_ID!, APNS_TEAM_ID!, APNS_AUTH_KEY!);
      } catch (jwtErr) {
        console.error("Failed to build APNS JWT:", jwtErr);
      }
    }

    // ── Process each token ───────────────────────────────────────────────────
    for (const tokenRow of tokens as DevicePushToken[]) {
      const { id: tokenId, token, platform } = tokenRow;

      try {
        let resp: Response;

        if (platform === "android" || platform === "web") {
          // ── FCM (Android + Web Push) ─────────────────────────────────────
          if (!FCM_SERVER_KEY) {
            console.log(`FCM_SERVER_KEY not configured, skipping token ${tokenId}`);
            skipped++;
            continue;
          }

          const fcmPayload: Record<string, unknown> = {
            to: token,
            notification: { title: input.title, body: input.body },
          };
          if (input.data && Object.keys(input.data).length > 0) {
            fcmPayload.data = input.data;
          }

          resp = await fetch("https://fcm.googleapis.com/fcm/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `key=${FCM_SERVER_KEY}`,
            },
            body: JSON.stringify(fcmPayload),
          });
        } else if (platform === "ios") {
          // ── APNS ─────────────────────────────────────────────────────────
          if (!apnsConfigured) {
            console.log("APNS not configured, skipping");
            skipped++;
            continue;
          }
          if (!apnsJwt) {
            console.log(`APNS JWT unavailable, skipping token ${tokenId}`);
            skipped++;
            continue;
          }

          const apnsPayload = {
            aps: {
              alert: { title: input.title, body: input.body },
              sound: "default",
            },
            ...(input.data ?? {}),
          };

          resp = await fetch(`https://api.push.apple.com/3/device/${token}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `bearer ${apnsJwt}`,
              "apns-push-type": "alert",
              "apns-priority": "10",
            },
            body: JSON.stringify(apnsPayload),
          });
        } else {
          console.log(`Unknown platform '${platform}' for token ${tokenId}, skipping`);
          skipped++;
          continue;
        }

        // ── Handle response ──────────────────────────────────────────────────
        const isInvalidToken = resp.status === 404 || resp.status === 410;
        const isSuccess = resp.ok;

        if (isInvalidToken) {
          console.log(`Token ${tokenId} is invalid (${resp.status}), marking inactive`);
          await supabase
            .from("device_push_tokens")
            .update({ active: false })
            .eq("id", tokenId);
          failed++;
        } else if (isSuccess) {
          await supabase
            .from("device_push_tokens")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", tokenId);
          sent++;
        } else {
          const errBody = await resp.text().catch(() => "");
          console.error(`Push failed for token ${tokenId}: ${resp.status} ${errBody}`);
          await supabase
            .from("device_push_tokens")
            .update({ error_count: tokenRow.error_count + 1 })
            .eq("id", tokenId);
          failed++;
        }
      } catch (err) {
        console.error(`Exception sending to token ${tokenId}:`, err);
        await supabase
          .from("device_push_tokens")
          .update({ error_count: tokenRow.error_count + 1 })
          .eq("id", tokenId);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ sent, failed, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
