import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";

const REPO_OWNER = "KaiyzerCal";
const REPO_NAME = "system_prompts_leaks";
const REPO_BRANCH = "main";

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifyAuth(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return false;
  if (token === SERVICE_ROLE) return true;
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "MAVIS-PromptVault/1.0",
  };
  if (GITHUB_TOKEN) h["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

// List directory contents at path (empty path = root)
async function listDir(path: string) {
  const encodedPath = path ? `/${encodeURIComponent(path).replace(/%2F/g, "/")}` : "";
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents${encodedPath}?ref=${REPO_BRANCH}`;
  const res = await fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
  const items = await res.json() as Array<{ name: string; path: string; type: string; size: number; sha: string; download_url: string | null }>;
  return items.map(i => ({
    name: i.name,
    path: i.path,
    type: i.type, // "file" | "dir"
    size: i.size,
  }));
}

// Fetch raw file content
async function readFile(path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${path}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "MAVIS-PromptVault/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Raw fetch ${res.status}: ${path}`);
  return res.text();
}

// GitHub code search within the repo
async function searchRepo(query: string, limit = 10) {
  const q = encodeURIComponent(`${query} repo:${REPO_OWNER}/${REPO_NAME}`);
  const url = `https://api.github.com/search/code?q=${q}&per_page=${Math.min(limit, 30)}`;
  const res = await fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub search ${res.status}: ${body}`);
  }
  const data = await res.json() as { total_count: number; items: Array<{ name: string; path: string; score: number }> };
  return {
    total: data.total_count,
    results: data.items.map(i => ({ name: i.name, path: i.path, score: i.score })),
  };
}

// Recent commits (what changed lately)
async function recentCommits(limit = 10) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=${Math.min(limit, 20)}&sha=${REPO_BRANCH}`;
  const res = await fetch(url, { headers: githubHeaders(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub commits ${res.status}`);
  const data = await res.json() as Array<{
    sha: string;
    commit: { message: string; author: { date: string } };
    html_url: string;
  }>;
  return data.map(c => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    date: c.commit.author.date,
  }));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await verifyAuth(req))) return err("Unauthorized", 401);

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
      // List a directory (path="" = root)
      case "list": {
        const path = String(params.path ?? "");
        const items = await listDir(path);
        return ok({ path, items });
      }

      // Read a file's raw content (markdown)
      case "read": {
        const path = String(params.path ?? "");
        if (!path) return err("path required", 400);
        const content = await readFile(path);
        return ok({ path, content, length: content.length });
      }

      // Search for a model/term across the repo
      case "search": {
        const query = String(params.query ?? "");
        if (!query) return err("query required", 400);
        const limit = Number(params.limit ?? 10);
        const data = await searchRepo(query, limit);
        return ok(data);
      }

      // Recent activity
      case "recent": {
        const limit = Number(params.limit ?? 10);
        const commits = await recentCommits(limit);
        return ok({ commits });
      }

      // Get a named prompt — provider + model shorthand
      // e.g. provider="Anthropic" model="claude-opus-4.8" → finds closest match
      case "get_prompt": {
        const provider = String(params.provider ?? "");
        const model = String(params.model ?? "");
        if (!provider) return err("provider required", 400);

        // List the provider directory
        const items = await listDir(provider);
        let target = items.find(i =>
          i.type === "file" &&
          i.name.toLowerCase().includes(model.toLowerCase()) &&
          i.name.endsWith(".md")
        );
        // If not found directly, try a search
        if (!target && model) {
          const q = model.replace(/[-_]/g, " ");
          const sr = await searchRepo(`${q} ${provider}`);
          if (sr.results.length) target = { ...sr.results[0], type: "file", size: 0 };
        }
        if (!target) return err(`No prompt found for ${provider}/${model}`, 404);
        const content = await readFile(target.path);
        return ok({ path: target.path, name: target.name, content });
      }

      // Summarise: list root + first-level dirs to give MAVIS a complete overview
      case "overview": {
        const rootItems = await listDir("");
        const providers = rootItems.filter(i => i.type === "dir" && !i.name.startsWith("."));
        const expanded = await Promise.allSettled(
          providers.map(p => listDir(p.path).then(children => ({ ...p, children })))
        );
        return ok({
          providers: expanded
            .filter(r => r.status === "fulfilled")
            .map(r => (r as PromiseFulfilledResult<{ name: string; path: string; type: string; size: number; children: { name: string; path: string; type: string; size: number }[] }>).value),
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
