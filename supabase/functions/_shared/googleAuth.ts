// Shared Google OAuth token refresh.
//
// The same refreshGoogleToken shape is duplicated across ~17 edge functions
// today (mavis-google-agent, mavis-gdrive-sync, mavis-gmail-sync, etc.).
// This module exists so new functions (starting with mavis-youtube-publish)
// don't add an 18th copy — migrating the existing duplicates onto this is a
// separate cleanup, out of scope here.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface GoogleTokenConfig {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  email?: string;
  [key: string]: unknown;
}

/** Refreshes an expiring/expired Google access token and persists the new one. */
export async function refreshGoogleToken(
  config: GoogleTokenConfig,
  sb: SupabaseClient,
  uid: string,
  provider: string,
): Promise<string> {
  // Still valid for >5 min — no refresh needed.
  if (config.expires_at && config.expires_at > Date.now() / 1000 + 300) {
    return config.access_token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: config.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data).slice(0, 200));
  const newConfig: GoogleTokenConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await sb.from("mavis_user_integrations")
    .update({ config: newConfig })
    .eq("user_id", uid)
    .eq("provider", provider);
  return data.access_token;
}

/** Loads a user's stored Google OAuth config for `provider` and returns a fresh access token. */
export async function getGoogleToken(sb: SupabaseClient, uid: string, provider: string): Promise<string> {
  const { data: integration } = await sb
    .from("mavis_user_integrations")
    .select("config")
    .eq("user_id", uid)
    .eq("provider", provider)
    .single();
  if (!integration?.config?.refresh_token) {
    throw new Error(`Google ${provider} not connected — connect it in Integrations`);
  }
  return refreshGoogleToken(integration.config as GoogleTokenConfig, sb, uid, provider);
}
