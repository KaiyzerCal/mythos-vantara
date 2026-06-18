import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WPCOM_CLIENT_ID     = Deno.env.get("WPCOM_CLIENT_ID") ?? "";
const WPCOM_CLIENT_SECRET = Deno.env.get("WPCOM_CLIENT_SECRET") ?? "";
const WPCOM_REDIRECT_URI  = Deno.env.get("WPCOM_REDIRECT_URI") ?? "";
const SUPABASE_URL        = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, ...rest } = body;

    switch (action) {
      // ── Build the WP.com authorization URL ──────────────────────────
      case "get_auth_url": {
        if (!WPCOM_CLIENT_ID || !WPCOM_REDIRECT_URI) {
          throw new Error("WPCOM_CLIENT_ID and WPCOM_REDIRECT_URI must be configured in Supabase secrets");
        }
        const { project_id = null, user_id = null } = rest;
        const state = btoa(JSON.stringify({ project_id, user_id, ts: Date.now() }));
        const params = new URLSearchParams({
          client_id:     WPCOM_CLIENT_ID,
          redirect_uri:  WPCOM_REDIRECT_URI,
          response_type: "code",
          state,
        });
        return new Response(
          JSON.stringify({ url: `https://public-api.wordpress.com/oauth2/authorize?${params}`, state }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ── Exchange auth code for access token ──────────────────────────
      case "exchange_code": {
        const { code, state, project_id: rawProjectId } = rest;
        if (!code) throw new Error("code is required");

        // Decode state
        let stateData: { project_id?: string | null; user_id?: string | null } = {};
        try { stateData = JSON.parse(atob(state ?? "")); } catch { /* state is optional */ }

        const project_id = rawProjectId ?? stateData.project_id ?? null;
        const user_id    = stateData.user_id ?? null;

        // Exchange code → access token
        const tokenRes = await fetch("https://public-api.wordpress.com/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id:     WPCOM_CLIENT_ID,
            client_secret: WPCOM_CLIENT_SECRET,
            redirect_uri:  WPCOM_REDIRECT_URI,
            code,
            grant_type: "authorization_code",
          }).toString(),
        });

        if (!tokenRes.ok) {
          const err = await tokenRes.text();
          throw new Error(`WP.com token exchange failed: ${err.slice(0, 300)}`);
        }

        const { access_token, blog_id, blog_url } = await tokenRes.json();
        if (!access_token) throw new Error("No access_token in WP.com response");

        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        const credRecord: Record<string, any> = {
          auth_type:            "wpcom_oauth",
          wpcom_access_token:   access_token,
          wpcom_blog_id:        blog_id ? Number(blog_id) : null,
          wpcom_site_domain:    blog_url ?? null,
          site_url:             blog_url ?? "",
          wp_username:          "",
          app_password:         "",
          verified:             true,
          ...(project_id ? { project_id } : {}),
          ...(user_id    ? { user_id    } : {}),
        };

        let credId: string | null = null;

        if (project_id) {
          const { data, error } = await sb.from("wp_credentials")
            .upsert(credRecord, { onConflict: "project_id" })
            .select("id").single();
          if (error) throw error;
          credId = data?.id ?? null;
        } else {
          const { data, error } = await sb.from("wp_credentials")
            .insert(credRecord).select("id").single();
          if (error) throw error;
          credId = data?.id ?? null;
        }

        return new Response(
          JSON.stringify({
            success:            true,
            credential_id:      credId,
            access_token,             // returned so popup can relay to parent window
            wpcom_blog_id:      blog_id     ? Number(blog_id) : null,
            wpcom_site_domain:  blog_url    ?? null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (err: any) {
    console.error("mavis-wpcom-oauth error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
