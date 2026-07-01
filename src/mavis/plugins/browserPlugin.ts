/**
 * Browser Agent Plugin — Antigravity browser verification & context retrieval pattern.
 * Provides MAVIS agents with the ability to:
 *   - Fetch and read any URL (Jina.ai reader, same as mavis-ingest-url)
 *   - Verify factual claims against live web sources
 *   - Search the web and pull structured results
 *   - Extract structured data from pages
 *   - Cache snapshots in mavis_browser_snapshots for reuse within a session
 *
 * In Antigravity: the agent "opens Chrome, navigates, clicks, and records proof."
 * In MAVIS (browser context): uses Jina.ai reader for deep content extraction,
 * DuckDuckGo instant answers for search, and structured cache for session reuse.
 */

import { supabase as _sb } from "@/integrations/supabase/client";
const supabase: any = _sb;
import { storeMemory } from "@/mavis/agentMemoryEngine";
import { toolRegistry } from "@/mavis/toolRegistry";
import type { MavisPlugin, MavisAction, MavisProvider, PluginContext, ActionResult } from "@/mavis/pluginSystem";

const JINA_BASE = "https://r.jina.ai/";
const DDGS_BASE  = "https://api.duckduckgo.com/";
const SNAPSHOT_TTL = 3600; // 1 hour

// ── Content fetcher ───────────────────────────────────────────────────────────

interface PageSnapshot {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  links: Array<{ href: string; text: string }>;
  metadata: Record<string, string>;
  fetchedAt: number;
}

async function fetchViaJina(url: string): Promise<PageSnapshot | null> {
  try {
    const res = await fetch(`${JINA_BASE}${encodeURIComponent(url)}`, {
      headers: {
        Accept: "application/json",
        "X-Return-Format": "markdown",
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const titleMatch = text.match(/^#\s+(.+)/m);
    const title = titleMatch?.[1]?.trim() ?? new URL(url).hostname;

    const linkMatches = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)];
    const links = linkMatches.slice(0, 30).map(m => ({ text: m[1], href: m[2] }));

    return {
      url,
      finalUrl: url,
      title,
      text: text.slice(0, 12000),
      links,
      metadata: {},
      fetchedAt: Date.now(),
    };
  } catch { return null; }
}

async function getSnapshot(url: string, userId: string): Promise<PageSnapshot | null> {
  // Check cache first
  const { data: cached } = await supabase
    .from("mavis_browser_snapshots")
    .select("*")
    .eq("user_id", userId)
    .eq("url", url)
    .single()
    .catch(() => ({ data: null }));

  if (cached) {
    const age = (Date.now() - new Date(cached.fetched_at as string).getTime()) / 1000;
    if (age < (cached.ttl_seconds as number)) {
      return {
        url: cached.url as string,
        finalUrl: (cached.final_url as string) ?? cached.url as string,
        title: (cached.title as string) ?? "",
        text: (cached.content_text as string) ?? "",
        links: (cached.links as Array<{ href: string; text: string }>) ?? [],
        metadata: (cached.metadata as Record<string, string>) ?? {},
        fetchedAt: new Date(cached.fetched_at as string).getTime(),
      };
    }
  }

  // Fetch fresh
  const snap = await fetchViaJina(url);
  if (!snap) return null;

  // Cache in DB
  await supabase.from("mavis_browser_snapshots").upsert({
    user_id: userId,
    url: snap.url,
    final_url: snap.finalUrl,
    title: snap.title,
    content_text: snap.text,
    content_length: snap.text.length,
    links: snap.links,
    metadata: snap.metadata,
    fetch_method: "jina",
    ttl_seconds: SNAPSHOT_TTL,
    fetched_at: new Date().toISOString(),
  }, { onConflict: "user_id,url" }).catch(() => {/* non-fatal */});

  return snap;
}

// ── Web search via DuckDuckGo ─────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function webSearch(query: string): Promise<SearchResult[]> {
  try {
    const url = `${DDGS_BASE}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { headers: { "User-Agent": "MAVIS/1.0" } });
    if (!res.ok) return [];
    const data = await res.json();

    const results: SearchResult[] = [];

    // Abstract (featured snippet)
    if (data.Abstract) {
      results.push({
        title: data.Heading ?? query,
        url: data.AbstractURL ?? "",
        snippet: data.Abstract,
      });
    }

    // Related topics
    for (const topic of (data.RelatedTopics ?? []).slice(0, 8)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.slice(0, 60),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }

    // Results
    for (const r of (data.Results ?? []).slice(0, 5)) {
      results.push({ title: r.Text ?? "", url: r.FirstURL ?? "", snippet: r.Text ?? "" });
    }

    return results;
  } catch { return []; }
}

// ── Claim verification ────────────────────────────────────────────────────────

async function verifyClaim(
  claim: string,
  userId: string
): Promise<{ verdict: "supported" | "contradicted" | "unverified"; sources: SearchResult[]; evidence: string }> {
  const results = await webSearch(claim);
  if (!results.length) {
    return { verdict: "unverified", sources: [], evidence: "No web results found for this claim." };
  }

  const snippets = results.slice(0, 3).map(r => `[${r.title}] ${r.snippet}`).join("\n");

  // Simple heuristic verdict based on keyword presence
  const claimWords = claim.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const snippetText = snippets.toLowerCase();
  const matchScore = claimWords.filter(w => snippetText.includes(w)).length / claimWords.length;

  const verdict = matchScore > 0.6 ? "supported" : matchScore > 0.2 ? "unverified" : "unverified";

  return {
    verdict,
    sources: results.slice(0, 3),
    evidence: snippets,
  };
}

// ── Actions ───────────────────────────────────────────────────────────────────

const BROWSE_URL: MavisAction = {
  name: "BROWSE_URL",
  similes: ["browse", "fetch url", "open url", "read webpage", "visit site", "get page"],
  description: "Fetch and read the content of any URL",
  async validate(_ctx, input) { return /^https?:\/\//i.test(input.trim()); },
  async handler(ctx, input): Promise<ActionResult> {
    const url = input.trim();
    const snap = await getSnapshot(url, ctx.userId);
    if (!snap) return { success: false, output: `Could not fetch: ${url}`, error: "Fetch failed" };

    const output = `**${snap.title}**\n${snap.url}\n\n${snap.text.slice(0, 3000)}`;

    await storeMemory({
      agentId: ctx.agentId, agentName: ctx.agentName, agentType: "plugin",
      entityType: "experience", memoryType: "working",
      content: `Browsed: ${snap.title} (${snap.url})\n${snap.text.slice(0, 800)}`,
      summary: `Web page: ${snap.title}`,
      tags: ["browsed", "web", new URL(url).hostname],
      wikilinks: [`[[${snap.title}]]`],
      importance: 5, confidence: 8, sourceSession: ctx.agentId,
    }, ctx.userId);

    return { success: true, output, data: snap };
  },
};

const WEB_SEARCH: MavisAction = {
  name: "WEB_SEARCH",
  similes: ["search web", "google", "search for", "look up", "find online", "web search"],
  description: "Search the web and return relevant results",
  async validate(_ctx, input) { return input.trim().length > 2; },
  async handler(ctx, input): Promise<ActionResult> {
    const results = await webSearch(input.trim());
    if (!results.length) return { success: false, output: `No results for: ${input}`, error: "No results" };

    const output = results
      .slice(0, 6)
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet.slice(0, 200)}`)
      .join("\n\n");

    return { success: true, output: `Search results for "${input}":\n\n${output}`, data: results };
  },
};

const VERIFY_CLAIM: MavisAction = {
  name: "VERIFY_CLAIM",
  similes: ["verify", "fact check", "is it true", "check claim", "validate", "confirm"],
  description: "Verify a factual claim against live web sources",
  async validate(_ctx, input) { return input.trim().length > 5; },
  async handler(ctx, input): Promise<ActionResult> {
    const { verdict, sources, evidence } = await verifyClaim(input.trim(), ctx.userId);

    const icon = verdict === "supported" ? "✓" : verdict === "contradicted" ? "✗" : "?";
    const output = `**${icon} ${verdict.toUpperCase()}**: "${input}"\n\nEvidence:\n${evidence}\n\nSources:\n${sources.map(s => `- ${s.url}`).join("\n")}`;

    await storeMemory({
      agentId: ctx.agentId, agentName: ctx.agentName, agentType: "plugin",
      entityType: "fact", memoryType: "semantic",
      content: `Claim: "${input}"\nVerdict: ${verdict}\nEvidence: ${evidence.slice(0, 500)}`,
      summary: `Claim ${verdict}: ${input.slice(0, 80)}`,
      tags: ["verification", verdict, "web"],
      wikilinks: [],
      importance: 7, confidence: verdict === "supported" ? 8 : 4,
      sourceSession: ctx.agentId,
    }, ctx.userId);

    return { success: true, output, data: { verdict, sources, evidence } };
  },
};

const EXTRACT_DATA: MavisAction = {
  name: "EXTRACT_DATA",
  similes: ["extract", "scrape", "pull data", "get data from", "parse page"],
  description: "Extract structured data from a URL — tables, lists, key facts",
  async validate(_ctx, input) { return /^https?:\/\//i.test(input.trim()); },
  async handler(ctx, input): Promise<ActionResult> {
    const url = input.trim();
    const snap = await getSnapshot(url, ctx.userId);
    if (!snap) return { success: false, output: `Could not fetch: ${url}`, error: "Fetch failed" };

    // Extract tables (markdown table pattern)
    const tables = snap.text.match(/\|.+\|[\s\S]*?(?=\n\n|\n#|$)/g) ?? [];
    // Extract numbered/bulleted lists
    const lists = snap.text.match(/(?:^|\n)(?:\d+\.|[-*•])\s+.+(?:\n(?!\n).+)*/gm) ?? [];
    // Extract headings as structure
    const headings = snap.text.match(/^#{1,3}\s+.+/gm) ?? [];

    const extracted = {
      title: snap.title,
      url: snap.url,
      structure: headings.slice(0, 10),
      tables: tables.slice(0, 5).map(t => t.slice(0, 500)),
      lists: lists.slice(0, 5).map(l => l.slice(0, 300)),
      links: snap.links.slice(0, 10),
    };

    const output = [
      `**${snap.title}** — ${snap.url}`,
      headings.length ? `\nStructure:\n${headings.slice(0, 6).join("\n")}` : "",
      tables.length ? `\nTables found: ${tables.length}` : "",
      lists.length ? `\nLists found: ${lists.length}` : "",
    ].filter(Boolean).join("\n");

    return { success: true, output, data: extracted };
  },
};

const READ_MCP_RESOURCE: MavisAction = {
  name: "READ_MCP_RESOURCE",
  similes: ["read resource", "mcp resource", "get resource", "fetch resource"],
  description: "Read a resource from a connected MCP server by URI",
  async validate(_ctx, input) { return input.includes("://"); },
  async handler(_ctx, input): Promise<ActionResult> {
    const { mcpRegistry } = await import("@/mavis/mcpClient");
    const connected = mcpRegistry.listConnected();
    if (!connected.length) {
      return { success: false, output: "No MCP servers connected", error: "No servers" };
    }

    // Try each connected server
    for (const serverName of connected) {
      const client = mcpRegistry.getClient(serverName);
      if (!client) continue;
      try {
        const content = await client.readResource(input.trim());
        if (content) return { success: true, output: content.slice(0, 4000), data: { serverName, uri: input.trim() } };
      } catch {/* try next */}
    }

    return { success: false, output: `Resource not found: ${input}`, error: "Not found" };
  },
};

// ── Provider — injects recent browsing context into prompts ──────────────────

const browserContextProvider = {
  name: "BrowserContext",
  description: "Injects recently browsed URLs and search results into agent prompts",
  async get(ctx: PluginContext): Promise<string> {
    const { data } = await supabase
      .from("mavis_browser_snapshots")
      .select("url, title, fetched_at")
      .eq("user_id", ctx.userId)
      .order("fetched_at", { ascending: false })
      .limit(5)
      .catch(() => ({ data: null }));

    if (!data?.length) return "";
    return `Recent web context:\n${data.map((s: Record<string, unknown>) => `  • [${s.title}](${s.url})`).join("\n")}`;
  },
};

// ── Tool registry integration ─────────────────────────────────────────────────
// Register browser tools into the global tool registry so any agent can use them

toolRegistry.register({
  name: "browse_url",
  description: "Fetch and read the content of a URL using Jina.ai reader",
  category: "api",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to browse" },
    },
    required: ["url"],
  },
  async execute(params, userId) {
    const snap = await getSnapshot(params.url as string, userId);
    if (!snap) return { success: false, output: "", error: "Fetch failed" };
    return { success: true, output: snap.text.slice(0, 4000), data: snap };
  },
});

toolRegistry.register({
  name: "web_search",
  description: "Search the web using DuckDuckGo and return results",
  category: "api",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  async execute(params) {
    const results = await webSearch(params.query as string);
    const output = results.slice(0, 5).map(r => `${r.title}: ${r.snippet}`).join("\n");
    return { success: true, output, data: results };
  },
});

toolRegistry.register({
  name: "verify_claim",
  description: "Verify a factual claim against live web search results",
  category: "analysis",
  parameters: {
    type: "object",
    properties: {
      claim: { type: "string", description: "The claim to verify" },
    },
    required: ["claim"],
  },
  async execute(params, userId) {
    const { verdict, sources, evidence } = await verifyClaim(params.claim as string, userId);
    return {
      success: true,
      output: `Verdict: ${verdict}\nEvidence: ${evidence.slice(0, 500)}`,
      data: { verdict, sources },
    };
  },
});

// ── Plugin export ─────────────────────────────────────────────────────────────

export const browserPlugin: MavisPlugin = {
  name: "browser-agent",
  version: "1.0.0",
  description: "Browser verification and web context retrieval — Antigravity-pattern browser agent",
  author: "MAVIS",
  capabilities: ["inference", "tool", "research", "verification", "web"],
  requiredScopes: [],
  actions: [BROWSE_URL, WEB_SEARCH, VERIFY_CLAIM, EXTRACT_DATA, READ_MCP_RESOURCE],
  providers: [browserContextProvider],
  evaluators: [],
  async onEnable() {},
  async onDisable() {},
};
