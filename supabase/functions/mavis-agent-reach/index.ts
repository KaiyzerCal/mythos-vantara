import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// MAVIS Internet Agent — Deno implementation of Agent-Reach channel architecture
// https://github.com/KaiyzerCal/Agent-Reach
//
// Channels (free, no auth unless noted):
//  web_read      — Jina Reader, any URL → markdown
//  github_search — GitHub API, repos/code/issues (GITHUB_TOKEN optional)
//  github_read   — GitHub repo file/README reader
//  rss_read      — RSS/Atom feed parser (regex-based, no deps)
//  reddit_search — Reddit JSON API
//  youtube_info  — YouTube oEmbed metadata
//  exa_search    — Exa AI semantic search (EXA_API_KEY required)
//  multi_search  — web + github + reddit in parallel
//  channel_health — probe all channels

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function safeFetch(url: string, opts?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  } catch {
    return null;
  }
}

// ── RSS / Atom parser (no external deps) ────────────────────────────────────

function extractTag(text: string, tag: string): string {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?((?:[^<]|<(?!/${tag}>))*)(?:\\]\\]>)?</${tag}>`,
    "is",
  );
  return re.exec(text)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
}

function parseRSS(xml: string): { title: string; link: string; description: string; items: unknown[] } {
  const items: unknown[] = [];

  // RSS <item> blocks
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const b = m[1];
    const linkMatch = /<link>([^<]+)<\/link>/.exec(b);
    const guidMatch = /<guid[^>]*>([^<]+)<\/guid>/.exec(b);
    items.push({
      title: extractTag(b, "title"),
      link: (linkMatch?.[1] ?? guidMatch?.[1] ?? "").trim(),
      description: extractTag(b, "description").slice(0, 400),
      pubDate: extractTag(b, "pubDate") || extractTag(b, "published"),
    });
  }

  // Atom <entry> blocks (if no RSS items found)
  if (!items.length) {
    const entryRe = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((m = entryRe.exec(xml)) !== null) {
      const b = m[1];
      const hrefMatch = /href="([^"]+)"/.exec(b);
      items.push({
        title: extractTag(b, "title"),
        link: hrefMatch?.[1] ?? extractTag(b, "id"),
        description: (extractTag(b, "summary") || extractTag(b, "content")).slice(0, 400),
        pubDate: extractTag(b, "published") || extractTag(b, "updated"),
      });
    }
  }

  return {
    title: extractTag(xml, "title"),
    link: extractTag(xml, "link"),
    description: extractTag(xml, "description"),
    items: items.slice(0, 25),
  };
}

// ── Channels ─────────────────────────────────────────────────────────────────

async function webRead(url: string) {
  const jinaKey = Deno.env.get("JINA_API_KEY") ?? "";
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-No-Cache": "true",
    "X-Timeout": "15",
    "User-Agent": "MAVIS-AgentReach/1.0",
  };
  if (jinaKey) headers["Authorization"] = `Bearer ${jinaKey}`;

  const res = await safeFetch(`https://r.jina.ai/${url}`, { headers });
  if (!res?.ok) throw new Error(`Jina failed: ${res?.status ?? "timeout"}`);
  const content = await res.text();
  return { platform: "web", url, content: content.slice(0, 20000), length: content.length };
}

async function githubSearch(query: string, type = "repositories", language = "", limit = 10) {
  const token = Deno.env.get("GITHUB_TOKEN") ?? "";
  const q = language ? `${query} language:${language}` : query;
  const url = `https://api.github.com/search/${type}?q=${encodeURIComponent(q)}&sort=stars&per_page=${Math.min(limit, 30)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "MAVIS-AgentReach/1.0",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await safeFetch(url, { headers });
  if (!res?.ok) throw new Error(`GitHub API: ${res?.status ?? "timeout"}`);
  const data = await res.json();

  if (type === "repositories") {
    return {
      platform: "github",
      type: "repos",
      query,
      total: data.total_count,
      items: (data.items ?? []).map((r: any) => ({
        name: r.full_name,
        description: r.description,
        stars: r.stargazers_count,
        language: r.language,
        url: r.html_url,
        topics: (r.topics ?? []).slice(0, 5),
        updated: r.updated_at,
      })),
    };
  }
  if (type === "code") {
    return {
      platform: "github",
      type: "code",
      query,
      total: data.total_count,
      items: (data.items ?? []).map((r: any) => ({
        path: r.path,
        repo: r.repository?.full_name,
        url: r.html_url,
      })),
    };
  }
  // issues / pull requests
  return {
    platform: "github",
    type,
    query,
    items: (data.items ?? []).map((r: any) => ({
      title: r.title,
      state: r.state,
      url: r.html_url,
      body: (r.body ?? "").slice(0, 300),
      repo: r.repository_url?.split("/").slice(-2).join("/"),
      created: r.created_at,
    })),
  };
}

async function githubRead(owner: string, repo: string, path = "") {
  const token = Deno.env.get("GITHUB_TOKEN") ?? "";
  const url = path
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
    : `https://api.github.com/repos/${owner}/${repo}/readme`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "MAVIS-AgentReach/1.0",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await safeFetch(url, { headers });
  if (!res?.ok) throw new Error(`GitHub read: ${res?.status ?? "timeout"}`);
  const data = await res.json();

  // File with content
  if (data.content) {
    const raw = data.content.replace(/\n/g, "");
    const content = new TextDecoder().decode(
      Uint8Array.from(atob(raw), c => c.charCodeAt(0)),
    );
    return { platform: "github", type: "file", repo: `${owner}/${repo}`, path: data.path, content: content.slice(0, 20000), size: data.size };
  }
  // Directory listing
  return {
    platform: "github",
    type: "dir",
    repo: `${owner}/${repo}`,
    path,
    items: (data as any[]).map((f: any) => ({ name: f.name, type: f.type, path: f.path, size: f.size })),
  };
}

async function rssRead(url: string) {
  const res = await safeFetch(url, {
    headers: {
      "User-Agent": "MAVIS-AgentReach/1.0",
      Accept: "application/rss+xml, application/atom+xml, text/xml, */*",
    },
  });
  if (!res?.ok) throw new Error(`RSS fetch: ${res?.status ?? "timeout"}`);
  const xml = await res.text();
  return { platform: "rss", url, ...parseRSS(xml) };
}

async function redditSearch(query: string, subreddit = "", sort = "relevance", limit = 10) {
  const base = subreddit
    ? `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1`
    : `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}`;
  const url = `${base}&sort=${sort}&limit=${Math.min(limit, 25)}&t=month`;
  const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 MAVIS-AgentReach research bot" } });
  if (!res?.ok) throw new Error(`Reddit: ${res?.status ?? "timeout"}`);
  const data = await res.json();
  return {
    platform: "reddit",
    query,
    subreddit: subreddit || "all",
    items: (data.data?.children ?? []).map((c: any) => ({
      title: c.data.title,
      url: `https://reddit.com${c.data.permalink}`,
      subreddit: c.data.subreddit,
      score: c.data.score,
      comments: c.data.num_comments,
      selftext: (c.data.selftext ?? "").slice(0, 400),
      created: new Date(c.data.created_utc * 1000).toISOString(),
      is_self: c.data.is_self,
      link_url: c.data.url,
    })),
  };
}

async function youtubeInfo(url: string) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await safeFetch(oembedUrl);
  if (!res?.ok) throw new Error(`YouTube oEmbed: ${res?.status ?? "timeout"}`);
  const data = await res.json();
  return {
    platform: "youtube",
    url,
    title: data.title,
    author_name: data.author_name,
    author_url: data.author_url,
    thumbnail_url: data.thumbnail_url,
    type: data.type,
    note: "Full transcript/analysis: ask MAVIS to analyze this YouTube video directly in chat",
  };
}

async function exaSearch(query: string, numResults = 10) {
  const key = Deno.env.get("EXA_API_KEY");
  if (!key) throw new Error("EXA_API_KEY not configured — add it to Supabase secrets");
  const res = await safeFetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query, num_results: Math.min(numResults, 20), use_autoprompt: true, type: "neural" }),
  });
  if (!res?.ok) throw new Error(`Exa: ${res?.status ?? "timeout"}`);
  const data = await res.json();
  return {
    platform: "exa",
    query,
    items: (data.results ?? []).map((r: any) => ({
      title: r.title,
      url: r.url,
      published: r.publishedDate,
      author: r.author,
      text: (r.text ?? "").slice(0, 600),
    })),
  };
}

async function jinaSearchWeb(query: string) {
  // Jina's search endpoint (s.jina.ai) — returns ranked web results as text
  const jinaKey = Deno.env.get("JINA_API_KEY") ?? "";
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Timeout": "15",
    "User-Agent": "MAVIS-AgentReach/1.0",
  };
  if (jinaKey) headers["Authorization"] = `Bearer ${jinaKey}`;
  const res = await safeFetch(`https://s.jina.ai/${encodeURIComponent(query)}`, { headers });
  if (!res?.ok) throw new Error(`Jina search: ${res?.status ?? "timeout"}`);
  const content = await res.text();
  return { platform: "web", type: "search", query, content: content.slice(0, 8000), length: content.length };
}

async function multiSearch(query: string) {
  const [webRes, githubRes, redditRes] = await Promise.allSettled([
    jinaSearchWeb(query),
    githubSearch(query, "repositories", "", 5),
    redditSearch(query, "", "relevance", 5),
  ]);
  return {
    platform: "multi",
    query,
    results: {
      web:    webRes.status    === "fulfilled" ? webRes.value    : { error: (webRes    as PromiseRejectedResult).reason?.message },
      github: githubRes.status === "fulfilled" ? githubRes.value : { error: (githubRes as PromiseRejectedResult).reason?.message },
      reddit: redditRes.status === "fulfilled" ? redditRes.value : { error: (redditRes as PromiseRejectedResult).reason?.message },
    },
  };
}

async function channelHealth() {
  const checks = await Promise.allSettled([
    // Jina: probe with actual content fetch of a known simple URL
    safeFetch("https://r.jina.ai/https://example.com", { headers: { Accept: "text/plain", "X-Timeout": "8", "User-Agent": "MAVIS-AgentReach/1.0" } }),
    // GitHub: rate_limit endpoint always returns 200
    safeFetch("https://api.github.com/rate_limit", { headers: { "User-Agent": "MAVIS-AgentReach/1.0", Accept: "application/vnd.github.v3+json" } }),
    // Reddit: use old.reddit.com JSON which is more reliable
    safeFetch("https://old.reddit.com/r/worldnews.json?limit=1", { headers: { "User-Agent": "MAVIS-AgentReach/1.0 (test)" } }),
    Promise.resolve(!!Deno.env.get("EXA_API_KEY")),
    Promise.resolve(true), // RSS always available
  ]);
  const LABELS = [
    { name: "web", label: "Web (Jina Reader)" },
    { name: "github", label: "GitHub API" },
    { name: "reddit", label: "Reddit JSON" },
    { name: "exa", label: "Exa Search" },
    { name: "rss", label: "RSS Reader" },
  ];
  return {
    channels: LABELS.map((l, i) => {
      const r = checks[i];
      const ok = r.status === "fulfilled" && (typeof r.value === "boolean" ? r.value : (r.value as Response | null)?.ok === true);
      return { name: l.name, label: l.label, ok };
    }),
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth — require any Bearer token (user JWT or service role).
  // This function only reads public APIs, so we don't verify the JWT signature;
  // we just ensure no unauthenticated public access.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return err("Unauthorized", 401);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* no body */ }

  const { action = "channel_health", ...params } = body;

  try {
    switch (action) {
      case "web_read":
        if (!params.url) return err("url required");
        return json(await webRead(String(params.url)));

      case "github_search":
        if (!params.query) return err("query required");
        return json(await githubSearch(String(params.query), String(params.type ?? "repositories"), String(params.language ?? ""), Number(params.limit ?? 10)));

      case "github_read":
        if (!params.owner || !params.repo) return err("owner and repo required");
        return json(await githubRead(String(params.owner), String(params.repo), String(params.path ?? "")));

      case "rss_read":
        if (!params.url) return err("url required");
        return json(await rssRead(String(params.url)));

      case "reddit_search":
        if (!params.query) return err("query required");
        return json(await redditSearch(String(params.query), String(params.subreddit ?? ""), String(params.sort ?? "relevance"), Number(params.limit ?? 10)));

      case "youtube_info":
        if (!params.url) return err("url required");
        return json(await youtubeInfo(String(params.url)));

      case "exa_search":
        if (!params.query) return err("query required");
        return json(await exaSearch(String(params.query), Number(params.num_results ?? 10)));

      case "multi_search":
        if (!params.query) return err("query required");
        return json(await multiSearch(String(params.query)));

      case "channel_health":
        return json(await channelHealth());

      default:
        return err(`Unknown action: ${action}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`mavis-agent-reach [${action}]:`, msg);
    return err(msg, 500);
  }
});
