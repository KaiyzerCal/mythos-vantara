// mavis-vercel-agent
// Vercel deployments, projects, domains, and environment variables.
// Requires: VERCEL_TOKEN + optionally VERCEL_TEAM_ID
//
// Actions: list_projects | list_deployments | get_deployment | trigger_deploy
//          get_logs | list_domains | set_env_var | get_project

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERCEL_KEY  = Deno.env.get("VERCEL_TOKEN") ?? "";
const VERCEL_TEAM = Deno.env.get("VERCEL_TEAM_ID") ?? "";
const VERCEL_API  = "https://api.vercel.com";

function requireVercel() {
  if (!VERCEL_KEY) throw new Error("Vercel not configured. Set VERCEL_TOKEN in Supabase secrets.");
}

function teamQs(extra?: string): string {
  const parts: string[] = [];
  if (VERCEL_TEAM) parts.push(`teamId=${VERCEL_TEAM}`);
  if (extra) parts.push(extra);
  return parts.length ? `?${parts.join("&")}` : "";
}

async function vReq(path: string, method = "GET", body?: unknown): Promise<any> {
  requireVercel();
  const res = await fetch(`${VERCEL_API}${path}`, {
    method,
    headers: { "Authorization": `Bearer ${VERCEL_KEY}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(`Vercel error (${res.status}): ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    switch (action) {
      case "list_projects": {
        const limit = Math.min(Number(body.limit ?? 20), 100);
        const data  = await vReq(`/v9/projects${teamQs(`limit=${limit}`)}`);

        return json({
          projects: (data.projects ?? []).map((p: any) => ({
            id:          p.id,
            name:        p.name,
            framework:   p.framework,
            node_version: p.nodeVersion,
            git_url:     p.link?.repoUrl,
            created_at:  new Date(p.createdAt).toISOString(),
          })),
        });
      }

      case "get_project": {
        const projectId = String(body.project_id ?? body.name ?? "");
        if (!projectId) return json({ error: "project_id or name required" }, 400);
        const data = await vReq(`/v9/projects/${projectId}${teamQs()}`);
        return json({ id: data.id, name: data.name, framework: data.framework, domains: data.alias?.slice(0, 5) });
      }

      case "list_deployments": {
        const projectId = body.project_id ? String(body.project_id) : undefined;
        const limit     = Math.min(Number(body.limit ?? 10), 50);
        const qs        = teamQs(`limit=${limit}${projectId ? `&projectId=${projectId}` : ""}${body.target ? `&target=${body.target}` : ""}`);
        const data      = await vReq(`/v6/deployments${qs}`);

        return json({
          deployments: (data.deployments ?? []).map((d: any) => ({
            id:         d.uid,
            url:        `https://${d.url}`,
            name:       d.name,
            state:      d.state,
            target:     d.target,
            created_at: new Date(d.createdAt).toISOString(),
            git_branch: d.meta?.githubCommitRef,
            git_sha:    d.meta?.githubCommitSha?.slice(0, 7),
          })),
        });
      }

      case "get_deployment": {
        const deployId = String(body.deployment_id ?? body.id ?? "");
        if (!deployId) return json({ error: "deployment_id required" }, 400);
        const data = await vReq(`/v13/deployments/${deployId}${teamQs()}`);

        return json({
          id:         data.id,
          url:        `https://${data.url}`,
          state:      data.readyState,
          target:     data.target,
          created_at: new Date(data.createdAt).toISOString(),
          build_duration: data.buildingAt && data.ready
            ? Math.round((data.ready - data.buildingAt) / 1000)
            : null,
        });
      }

      case "trigger_deploy": {
        // Redeploy by creating a new deployment for an existing project
        const projectId = String(body.project_id ?? "");
        if (!projectId) return json({ error: "project_id required" }, 400);

        const data = await vReq(`/v13/deployments${teamQs()}`, "POST", {
          name:     projectId,
          target:   body.target ?? "production",
          gitSource: body.git_ref ? { ref: body.git_ref, type: "github" } : undefined,
        });

        return json({ id: data.id, url: `https://${data.url}`, state: data.readyState });
      }

      case "get_logs": {
        const deployId = String(body.deployment_id ?? body.id ?? "");
        if (!deployId) return json({ error: "deployment_id required" }, 400);

        const data = await vReq(`/v2/deployments/${deployId}/events${teamQs(`limit=${body.limit ?? 100}`)}`);
        const logs = (data ?? []).map((e: any) => ({
          type:    e.type,
          text:    e.payload?.text ?? e.payload?.info?.message ?? "",
          created: e.created,
        })).filter((e: any) => e.text);

        return json({ logs, deployment_id: deployId });
      }

      case "list_domains": {
        const data = await vReq(`/v5/domains${teamQs()}`);
        return json({
          domains: (data.domains ?? []).map((d: any) => ({
            name:       d.name,
            verified:   d.verified,
            ns:         d.nameservers,
            created_at: new Date(d.createdAt).toISOString(),
          })),
        });
      }

      case "set_env_var": {
        const projectId = String(body.project_id ?? "");
        const key       = String(body.key ?? "");
        const value     = String(body.value ?? "");
        const targets   = (body.targets as string[] | undefined) ?? ["production", "preview"];

        if (!projectId || !key || !value) return json({ error: "project_id, key, and value required" }, 400);

        const data = await vReq(`/v10/projects/${projectId}/env${teamQs()}`, "POST", {
          key,
          value,
          type:    body.type ?? "encrypted",
          target:  targets,
        });

        return json({ id: data.id, key: data.key, target: data.target });
      }

      default:
        return json({
          error: `Unknown action: ${action}. Use: list_projects | get_project | list_deployments | get_deployment | trigger_deploy | get_logs | list_domains | set_env_var`,
        }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-vercel-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
