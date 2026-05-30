import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshGoogleToken(config: any, adminSb: any, uid: string, provider: string): Promise<string> {
  if (config.expires_at && config.expires_at > Date.now() / 1000 + 300) return config.access_token;
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
  if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data));
  const newConfig = {
    ...config,
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
  };
  await adminSb.from("mavis_user_integrations").update({ config: newConfig }).eq("user_id", uid).eq("provider", provider);
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSb = createClient(supabaseUrl, serviceRoleKey);

    // Auth → uid
    let uid: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const userSb = createClient(supabaseUrl, token);
      const { data: { user } } = await userSb.auth.getUser();
      uid = user?.id ?? null;
    }
    if (!uid) uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
    if (!uid) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Get gcontacts OAuth config
    const { data: integration } = await adminSb
      .from("mavis_user_integrations")
      .select("config")
      .eq("user_id", uid)
      .eq("provider", "gcontacts")
      .single();

    if (!integration?.config) {
      return new Response(
        JSON.stringify({ error: "Google Contacts not connected. Add OAuth credentials in Integrations." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const config = integration.config;
    const token = await refreshGoogleToken(config, adminSb, uid, "gcontacts");

    // Fetch contacts
    const contactsRes = await fetch(
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations&pageSize=200",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const contactsData = await contactsRes.json();
    const connections = contactsData.connections ?? [];

    let count = 0;

    for (const conn of connections) {
      const name = conn.names?.[0]?.displayName ?? "";
      const email = conn.emailAddresses?.[0]?.value ?? "";
      const phone = conn.phoneNumbers?.[0]?.value ?? null;
      const company = conn.organizations?.[0]?.name ?? null;

      if (!email) continue;

      await adminSb.from("contacts").upsert(
        {
          user_id: uid,
          name,
          email: email.toLowerCase(),
          phone,
          company,
          source: "google_contacts",
        },
        { onConflict: "user_id,email" },
      );
      count++;
    }

    return new Response(
      JSON.stringify({ synced: count }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
