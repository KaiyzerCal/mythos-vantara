// mavis-google-oauth
// Handles the full Google OAuth 2.0 flow for MAVIS.
// Actions: get_auth_url | exchange_code | get_status | disconnect
//
// Once connected, tokens are stored in mavis_user_integrations for each
// Google provider (gmail, gdrive, gcontacts, google_tasks, google_calendar)
// so the sync functions can pick them up automatically.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// All Google services MAVIS syncs — one row per provider after connecting
const GOOGLE_PROVIDERS = ["gmail", "gdrive", "gcontacts", "google_tasks", "google_calendar"] as const;

// OAuth scopes needed across all MAVIS Google features
const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://mail.google.com/",                                      // Gmail full read
  "https://www.googleapis.com/auth/drive",                         // Drive full read+write
  "https://www.googleapis.com/auth/spreadsheets",                  // Sheets API v4 cell-level read+write
  "https://www.googleapis.com/auth/documents",                     // Docs API full access
  "https://www.googleapis.com/auth/contacts.readonly",            // Contacts read
  "https://www.googleapis.com/auth/tasks",                         // Tasks read+write
  "https://www.googleapis.com/auth/calendar",                      // Calendar read+write
].join(" ");

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
    const { action, user_id: bodyUserId, redirect_origin } = body as Record<string, string>;

    // Resolve calling user
    let userId = bodyUserId ?? "";
    if (!userId) {
      const authHeader = req.headers.get("authorization") ?? "";
      if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "");
        if (token !== SERVICE_KEY) {
          const { data } = await createClient(SUPABASE_URL, token).auth.getUser();
          userId = data.user?.id ?? "";
        }
      }
    }

    if (!userId) return json({ error: "user_id required" }, 401);

    switch (action) {
      // ── Build Google consent URL ────────────────────────────────
      case "get_auth_url": {
        const { clientId } = await getCredentials(userId, adminSb);
        if (!clientId) return json({ error: "Save your Google Client ID first" }, 400);

        const origin = redirect_origin ?? "http://localhost:8080";
        const redirectUri = `${origin}/integrations`;

        const state = btoa(JSON.stringify({ user_id: userId, redirect_origin: origin, ts: Date.now() }));
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

        // Decode state
        let stateData: { user_id?: string; redirect_origin?: string } = {};
        try { stateData = JSON.parse(atob(state ?? "")); } catch { /* optional */ }

        const uid          = stateData.user_id ?? userId;
        const origin       = stateData.redirect_origin ?? redirect_origin ?? "http://localhost:8080";
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
