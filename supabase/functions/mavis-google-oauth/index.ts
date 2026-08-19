// mavis-google-oauth
// Handles the full Google OAuth 2.0 flow for MAVIS.
// Actions: get_auth_url | exchange_code | get_status | disconnect
//
// Once connected, tokens are stored in mavis_user_integrations for every
// Google provider so all sync functions and the google_api tool can use them.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveAuthedUid } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Every Google service MAVIS can use — one integration row per provider after connecting.
// All rows share the same underlying OAuth token (same client ID / refresh token).
const GOOGLE_PROVIDERS = [
  // Core workspace
  "gmail", "gdrive", "gcontacts", "google_tasks", "google_calendar",
  // Media + content
  "google_photos", "youtube", "blogger",
  // Analytics + marketing
  "google_analytics", "search_console", "google_ads",
  // Health + fitness
  "google_fit",
] as const;

// OAuth scopes — covers every Google API the operator has enabled in Cloud Console.
// Re-authenticate if new scopes were added after the initial connect.
const SCOPES = [
  // Identity
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // Gmail
  "https://mail.google.com/",
  // Drive + Docs + Sheets
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  // Contacts + Tasks + Calendar
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar",
  // Google Photos
  "https://www.googleapis.com/auth/photoslibrary.readonly",
  // YouTube
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  // Analytics + Search Console
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  // Google Ads
  "https://www.googleapis.com/auth/adwords",
  // Google Fit
  "https://www.googleapis.com/auth/fitness.activity.read",
  "https://www.googleapis.com/auth/fitness.body.read",
  "https://www.googleapis.com/auth/fitness.location.read",
  "https://www.googleapis.com/auth/fitness.sleep.read",
  // Blogger
  "https://www.googleapis.com/auth/blogger",
].join(" ");

// ── Signed state ─────────────────────────────────────────────────────────
// `state` round-trips through Google and back unauthenticated, so it must be
// tamper-proof: previously it was plain base64(JSON), letting a caller bind
// their own Google auth code to an arbitrary victim user_id (IDOR). It's now
// HMAC-signed with the service-role key (a secret only this backend knows)
// and expires after 15 minutes.
const STATE_SECRET = SERVICE_KEY;
const STATE_TTL_MS = 15 * 60 * 1000;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function signState(payload: Record<string, unknown>): Promise<string> {
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(STATE_SECRET), new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64url(new Uint8Array(sig))}`;
}

async function verifyState(state: string | undefined): Promise<{ user_id?: string; redirect_origin?: string } | null> {
  if (!state) return null;
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(STATE_SECRET),
    b64urlToBytes(sigB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
    if (typeof data.ts !== "number" || Date.now() - data.ts > STATE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

async function getCredentials(userId: string, adminSb: ReturnType<typeof createClient>) {
  // User stores their Google Cloud OAuth client_id + client_secret in the
  // google_workspace integration row (key_name: "Client ID" / "Client Secret")
  const { data } = await adminSb
    .from("mavis_user_integrations")
    .select("key_name, key_value")
    .eq("user_id", userId)
    .eq("provider", "google_workspace");

  const rows: { key_name: string; key_value: string }[] = (data as any) ?? [];
  const clientId     = rows.find(r => r.key_name === "Client ID")?.key_value ?? "";
  const clientSecret = rows.find(r => r.key_name === "Client Secret")?.key_value ?? "";
  return { clientId, clientSecret };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const { action, redirect_origin } = body as Record<string, string>;

    // Resolve calling user from a real session JWT, or trusted internal
    // caller (service-role key). Callers can no longer pass user_id directly
    // — that let anyone bind their own Google auth code to an arbitrary
    // victim's account (IDOR).
    const userId = await resolveAuthedUid(req, adminSb);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    switch (action) {
      // ── Build Google consent URL ────────────────────────────────
      case "get_auth_url": {
        const { clientId } = await getCredentials(userId, adminSb);
        if (!clientId) return json({ error: "Save your Google Client ID first" }, 400);

        const origin = redirect_origin ?? "http://localhost:8080";
        const redirectUri = `${origin}/integrations`;

        const state = await signState({ user_id: userId, redirect_origin: origin, ts: Date.now() });
        const params = new URLSearchParams({
          client_id:     clientId,
          redirect_uri:  redirectUri,
          response_type: "code",
          scope:         SCOPES,
          access_type:   "offline",
          prompt:        "consent",
          state,
        });

        return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state });
      }

      // ── Exchange auth code for tokens ───────────────────────────
      case "exchange_code": {
        const { code, state } = body as Record<string, string>;
        if (!code) return json({ error: "code is required" }, 400);

        // Verify the signed state (if present) instead of trusting it blindly —
        // an unsigned/tampered state previously let a caller bind their own
        // Google auth code to a victim's user_id.
        const stateData = await verifyState(state);
        if (state && !stateData) {
          return json({ error: "Invalid or expired OAuth state" }, 400);
        }
        if (stateData?.user_id && stateData.user_id !== userId) {
          return json({ error: "OAuth state does not match the authenticated user" }, 403);
        }

        const uid          = userId;
        const origin       = stateData?.redirect_origin ?? redirect_origin ?? "http://localhost:8080";
        const redirectUri  = `${origin}/integrations`;

        const { clientId, clientSecret } = await getCredentials(uid, adminSb);
        if (!clientId || !clientSecret) {
          return json({ error: "Google Client ID and Secret not found — save them first" }, 400);
        }

        // Exchange code → tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id:     clientId,
            client_secret: clientSecret,
            redirect_uri:  redirectUri,
            code,
            grant_type:    "authorization_code",
          }),
        });

        if (!tokenRes.ok) {
          const err = await tokenRes.text();
          return json({ error: `Google token exchange failed: ${err.slice(0, 300)}` }, 400);
        }

        const tokenData = await tokenRes.json();
        const { access_token, refresh_token, expires_in } = tokenData;
        if (!access_token) return json({ error: "No access_token in Google response" }, 400);

        // Fetch account email for display
        const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        const profile = profileRes.ok ? await profileRes.json() : {};
        const email = profile.email ?? "";

        const expiresAt = Math.floor(Date.now() / 1000) + (expires_in ?? 3600);
        const config = { client_id: clientId, client_secret: clientSecret, access_token, refresh_token, expires_at: expiresAt, email };

        // Upsert one row per Google provider so each sync function finds it
        for (const provider of GOOGLE_PROVIDERS) {
          await adminSb.from("mavis_user_integrations").upsert(
            { user_id: uid, provider, key_name: "oauth", key_value: email, config, status: "active" },
            { onConflict: "user_id,provider,key_name" },
          );
        }

        // Also mark google_workspace as connected
        await adminSb.from("mavis_user_integrations").upsert(
          { user_id: uid, provider: "google_workspace", key_name: "connected_email", key_value: email },
          { onConflict: "user_id,provider,key_name" },
        );

        return json({ success: true, email, providers: GOOGLE_PROVIDERS });
      }

      // ── Check connection status ─────────────────────────────────
      case "get_status": {
        const { data } = await adminSb
          .from("mavis_user_integrations")
          .select("provider, key_value, config")
          .eq("user_id", userId)
          .in("provider", ["google_workspace", ...GOOGLE_PROVIDERS]);

        const rows: { provider: string; key_value: string; config: any }[] = (data as any) ?? [];
        const emailRow = rows.find(r => r.provider === "google_workspace");
        const connected = rows.some(r => GOOGLE_PROVIDERS.includes(r.provider as any) && r.config?.refresh_token);

        const statuses: Record<string, boolean> = {};
        for (const p of GOOGLE_PROVIDERS) {
          const row = rows.find(r => r.provider === p);
          statuses[p] = !!(row?.config?.refresh_token);
        }

        return json({ connected, email: emailRow?.key_value ?? "", statuses });
      }

      // ── Disconnect — revoke token + delete rows ─────────────────
      case "disconnect": {
        // Get token to revoke
        const { data } = await adminSb
          .from("mavis_user_integrations")
          .select("config")
          .eq("user_id", userId)
          .eq("provider", "gmail")
          .single();

        const token = (data as any)?.config?.access_token;
        if (token) {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" })
            .catch(() => {/* ignore revoke errors */});
        }

        // Delete all Google rows for this user
        await adminSb.from("mavis_user_integrations")
          .delete()
          .eq("user_id", userId)
          .in("provider", ["google_workspace", ...GOOGLE_PROVIDERS]);

        return json({ success: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-google-oauth]", msg);
    return json({ error: msg }, 500);
  }
});
