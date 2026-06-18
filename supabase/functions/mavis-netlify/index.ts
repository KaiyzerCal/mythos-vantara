import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

async function sha1hex(content: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, netlify_token } = body;

    if (!netlify_token) return json({ error: "netlify_token is required" }, 400);

    const authHeader = { Authorization: `Bearer ${netlify_token}`, "Content-Type": "application/json" };

    // ── deploy ──────────────────────────────────────────────────────────────
    // files: { "index.html": "<html>...", "about.html": "..." }
    // site_id: optional — if omitted a new site is created
    // site_name: optional slug for new site creation
    if (action === "deploy") {
      const { files, site_id: existingSiteId, site_name } = body as {
        files: Record<string, string>;
        site_id?: string;
        site_name?: string;
      };

      if (!files || Object.keys(files).length === 0) {
        return json({ error: "files object is required" }, 400);
      }

      // 1. Create or resolve site
      let siteId = existingSiteId ?? "";
      let siteUrl = "";

      if (!siteId) {
        const slug = (site_name ?? `mavis-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const createRes = await fetch("https://api.netlify.com/api/v1/sites", {
          method: "POST",
          headers: authHeader,
          body: JSON.stringify({ name: slug }),
        });
        if (!createRes.ok) {
          const err = await createRes.text();
          return json({ error: `Failed to create Netlify site: ${err.slice(0, 200)}` }, 502);
        }
        const site = await createRes.json();
        siteId = site.id;
        siteUrl = site.ssl_url ?? site.url ?? "";
      }

      // 2. Compute SHA-1 digest map — paths must start with "/"
      const digestMap: Record<string, string> = {};
      const fileMap: Record<string, string> = {}; // "/path" → content
      for (const [filename, content] of Object.entries(files)) {
        const path = filename.startsWith("/") ? filename : `/${filename}`;
        const hash = await sha1hex(content);
        digestMap[path] = hash;
        fileMap[path] = content;
      }

      // 3. Create deploy with file digest map
      const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify({ files: digestMap }),
      });
      if (!deployRes.ok) {
        const err = await deployRes.text();
        return json({ error: `Netlify deploy creation failed: ${err.slice(0, 200)}` }, 502);
      }
      const deploy = await deployRes.json();
      const deployId: string = deploy.id;

      // 4. Upload each file Netlify says is required
      const required: string[] = deploy.required ?? [];
      const hashToPath = Object.fromEntries(Object.entries(digestMap).map(([p, h]) => [h, p]));
      for (const hash of required) {
        const path = hashToPath[hash];
        if (!path) continue;
        const content = fileMap[path] ?? "";
        await fetch(`https://api.netlify.com/api/v1/deploys/${deployId}/files${path}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${netlify_token}`, "Content-Type": "application/octet-stream" },
          body: content,
        });
      }

      // 5. Resolve site URL if we didn't create the site
      if (!siteUrl) {
        const siteRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
          headers: { Authorization: `Bearer ${netlify_token}` },
        });
        if (siteRes.ok) {
          const s = await siteRes.json();
          siteUrl = s.ssl_url ?? s.url ?? "";
        }
      }

      return json({
        success: true,
        data: { site_id: siteId, site_url: siteUrl, deploy_id: deployId, files_uploaded: required.length },
      });
    }

    // ── get_deploy ──────────────────────────────────────────────────────────
    if (action === "get_deploy") {
      const { deploy_id } = body as { deploy_id: string };
      if (!deploy_id) return json({ error: "deploy_id is required" }, 400);

      const res = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy_id}`, {
        headers: { Authorization: `Bearer ${netlify_token}` },
      });
      if (!res.ok) return json({ error: "Deploy not found" }, 404);
      const d = await res.json();
      return json({ success: true, data: { state: d.state, deploy_url: d.deploy_ssl_url ?? d.deploy_url, error_message: d.error_message } });
    }

    // ── list_sites ──────────────────────────────────────────────────────────
    if (action === "list_sites") {
      const res = await fetch("https://api.netlify.com/api/v1/sites?per_page=20", {
        headers: { Authorization: `Bearer ${netlify_token}` },
      });
      if (!res.ok) return json({ error: "Failed to list sites" }, 502);
      const sites = await res.json();
      return json({ success: true, data: sites.map((s: any) => ({ id: s.id, name: s.name, url: s.ssl_url ?? s.url, state: s.state })) });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("mavis-netlify error:", err);
    return json({ success: false, error: err.message ?? "Internal server error" }, 500);
  }
});
