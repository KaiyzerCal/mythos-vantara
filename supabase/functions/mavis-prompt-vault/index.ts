import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GITHUB_TOKEN   = Deno.env.get("GITHUB_TOKEN") ?? "";

const REPO_OWNER  = "KaiyzerCal";
const REPO_NAME   = "system_prompts_leaks";
const REPO_BRANCH = "main";

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function err(msg: string, status = 500) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function verifyAuth(req: Request): Promise<boolean> {
  const auth  = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return false;
  if (token === SERVICE_ROLE) return true;
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE } });
    return res.ok;
  } catch { return false; }
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "MAVIS-PromptVault/1.0",
  };
  if (GITHUB_TOKEN) h["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

// ── Supabase cache helpers ────────────────────────────────────────────────────

async function getCache(sb: any, key: string): Promise<any | null> {
  try {
    const { data } = await sb.from("mavis_worldmonitor_cache").select("data,expires_at").eq("cache_key", key).maybeSingle();
    if (data && new Date(data.expires_at) > new Date()) return data.data;
  } catch { /* ignore */ }
  return null;
}

async function setCache(sb: any, key: string, data: any, ttlSec: number) {
  try {
    await sb.from("mavis_worldmonitor_cache").upsert({
      cache_key: key, data,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }, { onConflict: "cache_key" });
  } catch { /* ignore */ }
}

// ── GitHub API helpers ────────────────────────────────────────────────────────

async function listDir(sb: any, path: string) {
  const cacheKey = `vault_list__${path || "ROOT"}`;
  const cached = await getCache(sb, cacheKey);
  if (cached) return cached;

  const encodedPath = path ? `/${encodeURIComponent(path).replace(/%2F/g, "/")}` : "";
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents${encodedPath}?ref=${REPO_BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders(), signal: AbortSignal.timeout(15000) });
  if (res.status === 403 || res.status === 429) {
    // Rate limited — if we have any old cache, return it
    const { data: stale } = await (sb as any).from("mavis_worldmonitor_cache").select("data").eq("cache_key", cacheKey).maybeSingle().catch(() => ({ data: null }));
    if (stale?.data) return stale.data;
    throw new Error(`GitHub rate-limited (${res.status}). Add GITHUB_TOKEN to Supabase secrets to increase quota.`);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path || "root"}`);
  const raw = await res.json() as Array<{ name: string; path: string; type: string; size: number }>;
  const items = raw.map(i => ({ name: i.name, path: i.path, type: i.type as "file"|"dir", size: i.size }));
  await setCache(sb, cacheKey, items, 86400); // 24 hours
  return items;
}

async function readFile(path: string): Promise<string> {
  // raw.githubusercontent.com has much higher rate limits and no auth needed for public repos
  const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${path}`;
  const res = await fetch(url, { headers: { "User-Agent": "MAVIS-PromptVault/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Raw fetch ${res.status}: ${path}`);
  return res.text();
}

async function searchRepo(sb: any, query: string, limit = 10) {
  const cacheKey = `vault_search__${query.slice(0, 60)}`;
  const cached = await getCache(sb, cacheKey);
  if (cached) return cached;

  const q   = encodeURIComponent(`${query} repo:${REPO_OWNER}/${REPO_NAME}`);
  const url = `https://api.github.com/search/code?q=${q}&per_page=${Math.min(limit, 30)}`;
  const res = await fetch(url, { headers: ghHeaders(), signal: AbortSignal.timeout(20000) });
  if (res.status === 403 || res.status === 429) {
    // Fallback: search by listing root and filtering by name
    try {
      const root = await listDir(sb, "");
      const lower = query.toLowerCase();
      const results = root
        .filter((i: any) => i.type === "dir" && i.name.toLowerCase().includes(lower))
        .map((i: any) => ({ name: i.name, path: i.path, score: 1 }))
        .slice(0, limit);
      return { total: results.length, results };
    } catch { /* fall through */ }
    throw new Error("GitHub search rate-limited. Add GITHUB_TOKEN to Supabase secrets.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub search ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { total_count: number; items: Array<{ name: string; path: string; score: number }> };
  const result = { total: data.total_count, results: data.items.map(i => ({ name: i.name, path: i.path, score: i.score })) };
  await setCache(sb, cacheKey, result, 3600); // 1 hour
  return result;
}

async function recentCommits(sb: any, limit = 10) {
  const cacheKey = "vault_commits";
  const cached = await getCache(sb, cacheKey);
  if (cached) return cached;

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=${Math.min(limit, 20)}&sha=${REPO_BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub commits ${res.status}`);
  const data = await res.json() as Array<{ sha: string; commit: { message: string; author: { date: string } } }>;
  const result = data.map(c => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split("\n")[0], date: c.commit.author.date }));
  await setCache(sb, cacheKey, result, 21600); // 6 hours
  return result;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await verifyAuth(req))) return err("Unauthorized", 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  let action: string;
  let params: Record<string, unknown>;
  try {
    const body = await req.json();
    action = String(body.action ?? "list");
    params = (body.params ?? body) as Record<string, unknown>;
  } catch {
    return err("Invalid JSON", 400);
  }

  try {
    switch (action) {
      case "list": {
        const path  = String(params.path ?? "");
        const items = await listDir(sb, path);
        return ok({ path, items });
      }

      case "read": {
        const path = String(params.path ?? "");
        if (!path) return err("path required", 400);
        const content = await readFile(path);
        return ok({ path, content, length: content.length });
      }

      case "search": {
        const query = String(params.query ?? "");
        if (!query) return err("query required", 400);
        const limit = Number(params.limit ?? 10);
        const data  = await searchRepo(sb, query, limit);
        return ok(data);
      }

      case "recent": {
        const limit   = Number(params.limit ?? 10);
        const commits = await recentCommits(sb, limit);
        return ok({ commits });
      }

      case "get_prompt": {
        const provider = String(params.provider ?? "");
        const model    = String(params.model    ?? "");
        if (!provider) return err("provider required", 400);
        const items = await listDir(sb, provider);
        let target = items.find((i: any) => i.type === "file" && i.name.toLowerCase().includes(model.toLowerCase()) && i.name.endsWith(".md"));
        if (!target && model) {
          const sr = await searchRepo(sb, `${model.replace(/[-_]/g, " ")} ${provider}`);
          if (sr.results.length) target = { ...sr.results[0], type: "file", size: 0 };
        }
        if (!target) return err(`No prompt found for ${provider}/${model}`, 404);
        const content = await readFile(target.path);
        return ok({ path: target.path, name: target.name, content });
      }

      case "overview": {
        const rootItems = await listDir(sb, "");
        const providers = rootItems.filter((i: any) => i.type === "dir" && !i.name.startsWith("."));
        const expanded  = await Promise.allSettled(
          providers.map((p: any) => listDir(sb, p.path).then((children: any) => ({ ...p, children })))
        );
        return ok({
          providers: expanded.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<any>).value),
        });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(msg);
  }
});
