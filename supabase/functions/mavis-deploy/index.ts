// mavis-deploy — multi-provider static site deployment
// Supports: Netlify, Vercel, Cloudflare Pages, Railway (zip), Hostinger (zip)

import { zipSync, strToU8 } from "https://esm.sh/fflate@0.8.2";

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

async function sha256hex(content: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

// ─────────────────────────────────────────────────────────────
// NETLIFY
// ─────────────────────────────────────────────────────────────
async function deployNetlify(
  files: Record<string, string>,
  token: string,
  siteId?: string,
  siteName?: string,
): Promise<object> {
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let id = siteId ?? "";
  let siteUrl = "";

  if (!id) {
    const slug = (siteName ?? `mavis-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const r = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST", headers: auth, body: JSON.stringify({ name: slug }),
    });
    if (!r.ok) throw new Error(`Netlify site create failed: ${(await r.text()).slice(0, 200)}`);
    const s = await r.json();
    id = s.id; siteUrl = s.ssl_url ?? s.url ?? "";
  }

  const digestMap: Record<string, string> = {};
  const fileMap: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    const path = name.startsWith("/") ? name : `/${name}`;
    digestMap[path] = await sha1hex(content);
    fileMap[path] = content;
  }

  const deployR = await fetch(`https://api.netlify.com/api/v1/sites/${id}/deploys`, {
    method: "POST", headers: auth, body: JSON.stringify({ files: digestMap }),
  });
  if (!deployR.ok) throw new Error(`Netlify deploy failed: ${(await deployR.text()).slice(0, 200)}`);
  const deploy = await deployR.json();
  const deployId: string = deploy.id;

  const required: string[] = deploy.required ?? [];
  const hashToPath = Object.fromEntries(Object.entries(digestMap).map(([p, h]) => [h, p]));
  for (const hash of required) {
    const path = hashToPath[hash];
    if (!path) continue;
    await fetch(`https://api.netlify.com/api/v1/deploys/${deployId}/files${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: fileMap[path],
    });
  }

  if (!siteUrl) {
    const sr = await fetch(`https://api.netlify.com/api/v1/sites/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (sr.ok) { const s = await sr.json(); siteUrl = s.ssl_url ?? s.url ?? ""; }
  }

  return { success: true, deploy_url: siteUrl, project_id: id, deploy_id: deployId, provider: "netlify" };
}

// ─────────────────────────────────────────────────────────────
// VERCEL
// ─────────────────────────────────────────────────────────────
async function deployVercel(
  files: Record<string, string>,
  token: string,
  projectName: string,
): Promise<object> {
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Upload each file blob (idempotent by SHA-1)
  const fileEntries: Array<{ file: string; sha: string; size: number }> = [];
  for (const [name, content] of Object.entries(files)) {
    const bytes = new TextEncoder().encode(content);
    const sha = await sha1hex(content);
    await fetch("https://api.vercel.com/v2/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Length": String(bytes.length),
        "x-now-digest": sha,
      },
      body: bytes,
    });
    fileEntries.push({ file: name, sha, size: bytes.length });
  }

  // Create deployment
  const slug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 52);
  const depR = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: slug,
      files: fileEntries,
      projectSettings: { framework: null, outputDirectory: null, buildCommand: null, installCommand: null },
      target: "production",
    }),
  });
  if (!depR.ok) throw new Error(`Vercel deploy failed: ${(await depR.text()).slice(0, 300)}`);
  const dep = await depR.json();

  const deployUrl = dep.alias?.[0]
    ? `https://${dep.alias[0]}`
    : dep.url ? `https://${dep.url}` : "";

  return { success: true, deploy_url: deployUrl, project_id: dep.projectId ?? slug, deploy_id: dep.id, provider: "vercel" };
}

// ─────────────────────────────────────────────────────────────
// CLOUDFLARE PAGES
// ─────────────────────────────────────────────────────────────
async function deployCloudflare(
  files: Record<string, string>,
  token: string,
  accountId: string,
  projectName: string,
): Promise<object> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;

  // Create project if it doesn't exist (ignore error if already exists)
  await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: projectName, production_branch: "main" }),
  });

  // Build multipart form — CF Pages direct upload: files keyed by SHA-256 hash
  const form = new FormData();
  const manifest: Record<string, string> = {};

  for (const [name, content] of Object.entries(files)) {
    const hash = await sha256hex(content);
    const path = name.startsWith("/") ? name : `/${name}`;
    manifest[path] = hash;
    form.append(hash, new Blob([content], { type: "text/html" }), name);
  }
  form.append("manifest", JSON.stringify(manifest));

  const depR = await fetch(`${base}/${projectName}/deployments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!depR.ok) throw new Error(`Cloudflare deploy failed: ${(await depR.text()).slice(0, 300)}`);
  const dep = await depR.json();

  const deployUrl = dep.result?.url
    ? `https://${dep.result.url}`
    : `https://${projectName}.pages.dev`;

  return { success: true, deploy_url: deployUrl, project_id: projectName, deploy_id: dep.result?.id, provider: "cloudflare" };
}

// ─────────────────────────────────────────────────────────────
// ZIP (Railway / Hostinger — download-based deploy)
// ─────────────────────────────────────────────────────────────
function buildZip(files: Record<string, string>): string {
  const zipInput: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    zipInput[name] = strToU8(content);
  }
  const zipped = zipSync(zipInput, { level: 6 });
  // Convert Uint8Array to base64
  let binary = "";
  for (let i = 0; i < zipped.length; i++) binary += String.fromCharCode(zipped[i]);
  return btoa(binary);
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { provider, files, token, site_id, site_name, project_name, account_id } = body as Record<string, string>;

  if (!provider) return json({ error: "provider is required" }, 400);
  if (!files || Object.keys(files).length === 0) return json({ error: "files is required" }, 400);

  const fileMap = files as unknown as Record<string, string>;

  try {
    switch (provider) {
      case "netlify":
        if (!token) return json({ error: "token is required for Netlify" }, 400);
        return json(await deployNetlify(fileMap, token, site_id, site_name));

      case "vercel":
        if (!token) return json({ error: "token is required for Vercel" }, 400);
        return json(await deployVercel(fileMap, token, project_name ?? site_name ?? `mavis-site`));

      case "cloudflare":
        if (!token || !account_id) return json({ error: "token and account_id required for Cloudflare" }, 400);
        return json(await deployCloudflare(fileMap, token, account_id, project_name ?? `mavis-site`));

      case "railway":
      case "hostinger":
        return json({ success: true, provider, zip: buildZip(fileMap) });

      default:
        return json({ error: `Unknown provider: ${provider}` }, 400);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mavis-deploy] ${provider} error:`, msg);
    return json({ success: false, error: msg }, 500);
  }
});
