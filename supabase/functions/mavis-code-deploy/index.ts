// MAVIS Code Deploy — MAVIS writes code, this deploys it to Netlify automatically.
// The code → deploy loop: generate → preview → ship, no manual steps.
//
// Request body:
//   { files: { "index.html": "<html>...</html>", "style.css": "..." }, title?: string }
//   OR { html: string, title?: string }  — single page shorthand
//
// Returns: { url, site_id, deploy_id, provider: "netlify" }
//
// Requires: NETLIFY_API_TOKEN in Supabase secrets (same token used by mavis-netlify).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL         = Deno.env.get("SUPABASE_URL")!;
const SB_KEY         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NETLIFY_TOKEN  = Deno.env.get("NETLIFY_API_TOKEN") ?? "";
const NETLIFY_API    = "https://api.netlify.com/api/v1";

async function sha1(content: string): Promise<string> {
  const bytes  = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createNetlifySite(name: string): Promise<{ id: string; url: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50) + "-" + Date.now().toString(36);
  const res = await fetch(`${NETLIFY_API}/sites`, {
    method: "POST",
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: slug, custom_domain: null }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Netlify site create error ${res.status}: ${err.slice(0, 200)}`);
  }
  const d = await res.json();
  return { id: d.id, url: d.ssl_url ?? d.url };
}

async function deployFiles(siteId: string, files: Record<string, string>): Promise<string> {
  // Step 1: compute SHA-1 digest for each file
  const fileDigests: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    fileDigests[`/${path.replace(/^\//, "")}`] = await sha1(content);
  }

  // Step 2: create deploy and get required files list
  const deployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ files: fileDigests, draft: false }),
  });
  if (!deployRes.ok) {
    const err = await deployRes.text();
    throw new Error(`Netlify deploy error ${deployRes.status}: ${err.slice(0, 200)}`);
  }
  const deploy = await deployRes.json();
  const deployId    = deploy.id;
  const required    = (deploy.required ?? []) as string[];

  // Step 3: upload required files
  for (const digest of required) {
    const path    = Object.entries(fileDigests).find(([, d]) => d === digest)?.[0];
    if (!path) continue;
    const content = files[path.replace(/^\//, "")];
    if (!content) continue;

    const uploadRes = await fetch(`${NETLIFY_API}/deploys/${deployId}/files${path}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        "Content-Type": "application/octet-stream",
      },
      body: new TextEncoder().encode(content),
    });
    if (!uploadRes.ok) {
      console.warn(`[mavis-code-deploy] Upload failed for ${path}: ${uploadRes.status}`);
    }
  }

  return deployId;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(SB_URL, SB_KEY);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!NETLIFY_TOKEN) {
      return new Response(
        JSON.stringify({ error: "NETLIFY_API_TOKEN not configured. Set it in Supabase edge function secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body  = await req.json().catch(() => ({}));
    const title = String(body.title ?? "MAVIS Deploy");

    // Normalize to files map
    let files: Record<string, string> = {};
    if (typeof body.html === "string") {
      files["index.html"] = body.html;
    } else if (body.files && typeof body.files === "object") {
      files = body.files;
    }

    if (!Object.keys(files).length) {
      return new Response(
        JSON.stringify({ error: "Provide { html: '...' } or { files: { 'index.html': '...' } }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Ensure there's an index.html
    if (!files["index.html"]) {
      const firstHtml = Object.entries(files).find(([k]) => k.endsWith(".html"));
      if (firstHtml) files["index.html"] = firstHtml[1];
    }

    // Create site + deploy
    const { id: siteId, url: siteUrl } = await createNetlifySite(title);
    const deployId = await deployFiles(siteId, files);

    // Log deploy to DB
    await sb.from("website_projects").insert({
      user_id: user.id,
      project_name: title,
      status: "published",
      netlify_site_url: siteUrl,
      netlify_site_id: siteId,
      pages_count: Object.keys(files).length,
    }).catch(() => {/* non-fatal */});

    return new Response(
      JSON.stringify({ url: siteUrl, site_id: siteId, deploy_id: deployId, provider: "netlify", files: Object.keys(files) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[mavis-code-deploy]", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
