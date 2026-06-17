// mavis-firecrawl-agent
// Deep website scraping via Firecrawl — handles JS-rendered pages, entire site maps,
// and structured data extraction. Far beyond single-page scraping.
// Requires: FIRECRAWL_API_KEY
//
// Actions: scrape | crawl | map | search | extract

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FC_KEY   = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
const FC_API   = "https://api.firecrawl.dev/v1";

function requireFirecrawl() {
  if (!FC_KEY) throw new Error("Firecrawl not configured. Set FIRECRAWL_API_KEY in Supabase secrets.");
}

async function fcReq(path: string, body: Record<string, unknown>): Promise<any> {
  requireFirecrawl();
  const res = await fetch(`${FC_API}${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${FC_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Firecrawl error (${res.status}): ${data.error ?? JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function fcGet(path: string): Promise<any> {
  requireFirecrawl();
  const res = await fetch(`${FC_API}${path}`, {
    headers: { "Authorization": `Bearer ${FC_KEY}` },
  });
  return res.json();
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
    const action = String(body.action ?? "scrape");

    switch (action) {
      case "scrape": {
        // Scrape a single URL — handles JS, returns markdown + structured data
        const url = String(body.url ?? "");
        if (!url) return json({ error: "url required" }, 400);

        const data = await fcReq("/scrape", {
          url,
          formats:          body.formats ?? ["markdown", "html"],
          onlyMainContent:  body.only_main !== false,
          includeTags:      body.include_tags,
          excludeTags:      body.exclude_tags ?? ["nav", "footer", "header", "aside"],
          waitFor:          body.wait_ms ?? 0,
          actions:          body.actions,
        });

        return json({
          url:         data.data?.metadata?.url ?? url,
          title:       data.data?.metadata?.title ?? "",
          description: data.data?.metadata?.description ?? "",
          markdown:    data.data?.markdown?.slice(0, 8000) ?? "",
          html:        body.include_html ? data.data?.html?.slice(0, 8000) : undefined,
          links:       data.data?.links?.slice(0, 50) ?? [],
          screenshot:  data.data?.screenshot,
        });
      }

      case "crawl": {
        // Crawl an entire site up to maxPages — async, returns job ID for polling
        const url = String(body.url ?? "");
        if (!url) return json({ error: "url required" }, 400);

        const maxPages = Math.min(Number(body.max_pages ?? 10), 50);

        // For sync mode (small crawls), use crawlUrl with async=false
        const data = await fcReq("/crawl", {
          url,
          limit:              maxPages,
          scrapeOptions: {
            formats:         ["markdown"],
            onlyMainContent: true,
            excludeTags:     ["nav", "footer", "header"],
          },
          excludePaths:    body.exclude_paths ?? [],
          includePaths:    body.include_paths ?? [],
          maxDepth:        Number(body.max_depth ?? 3),
          ignoreSitemap:   body.ignore_sitemap ?? false,
        });

        // If async, return job ID
        if (data.id) {
          return json({ job_id: data.id, status: "crawling", url, max_pages: maxPages, message: "Poll with action=poll_crawl&job_id=..." });
        }

        // Sync result
        const pages = (data.data ?? []).map((p: any) => ({
          url:      p.metadata?.url,
          title:    p.metadata?.title,
          content:  p.markdown?.slice(0, 2000),
        }));

        return json({ pages, count: pages.length, url });
      }

      case "poll_crawl": {
        const jobId = String(body.job_id ?? "");
        if (!jobId) return json({ error: "job_id required" }, 400);

        const data = await fcGet(`/crawl/${jobId}`);
        if (data.status === "completed") {
          const pages = (data.data ?? []).map((p: any) => ({
            url:     p.metadata?.url,
            title:   p.metadata?.title,
            content: p.markdown?.slice(0, 2000),
          }));
          return json({ status: "completed", pages, count: pages.length });
        }
        return json({ status: data.status, completed: data.completed, total: data.total, job_id: jobId });
      }

      case "map": {
        // Return all URLs from a domain without scraping content (fast)
        const url = String(body.url ?? "");
        if (!url) return json({ error: "url required" }, 400);

        const data = await fcReq("/map", {
          url,
          limit:         Math.min(Number(body.limit ?? 100), 500),
          search:        body.search,
          ignoreSitemap: body.ignore_sitemap ?? false,
          includeSubdomains: body.include_subdomains ?? false,
        });

        return json({ urls: data.links ?? [], count: data.links?.length ?? 0, url });
      }

      case "search": {
        // Search the web and return scraped content (Firecrawl-native)
        const query = String(body.query ?? "");
        if (!query) return json({ error: "query required" }, 400);

        const data = await fcReq("/search", {
          query,
          limit:           Math.min(Number(body.limit ?? 5), 10),
          scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
          lang:            body.lang ?? "en",
          country:         body.country ?? "us",
          tbs:             body.time_filter,
        });

        return json({
          results: (data.data ?? []).map((r: any) => ({
            url:         r.url,
            title:       r.metadata?.title,
            description: r.metadata?.description,
            content:     r.markdown?.slice(0, 1500),
          })),
          query,
        });
      }

      case "extract": {
        // Structured data extraction using AI schema
        const urls = Array.isArray(body.urls) ? body.urls as string[] : [String(body.url ?? "")];
        if (!urls.length || !urls[0]) return json({ error: "urls[] or url required" }, 400);

        const schema = body.schema as Record<string, unknown> | undefined;
        const prompt = body.prompt ? String(body.prompt) : "Extract all relevant information from this page.";

        const data = await fcReq("/extract", {
          urls,
          prompt,
          schema,
          enableWebSearch: body.web_search ?? false,
        });

        return json({ data: data.data, status: data.status });
      }

      case "digest": {
        // Scrape an index/list page, extract article links, AI-summarize each.
        // Uses Firecrawl when configured, falls back to native fetch for simple HTML sites.
        const indexUrl      = String(body.url ?? "");
        const limitN        = Math.min(Number(body.limit ?? 5), 10);
        const linkPattern   = body.link_pattern ? String(body.link_pattern) : "";
        const summaryPrompt = body.summary_prompt
          ? String(body.summary_prompt)
          : "Summarize this article in 3-5 sentences. Cover: main argument, key insights, and why it matters. Be concrete.";

        if (!indexUrl) return json({ error: "url required" }, 400);

        const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
        let baseUrl: URL;
        try { baseUrl = new URL(indexUrl); } catch { return json({ error: "Invalid url" }, 400); }

        // ── Step 1: Get links from index page ────────────────────────────────

        let rawLinks: string[] = [];

        if (FC_KEY) {
          const idxData = await fcReq("/scrape", {
            url:            indexUrl,
            formats:        ["links"],
            onlyMainContent: false,
          });
          rawLinks = idxData.data?.links ?? [];
        } else {
          // Native fetch fallback — works for static HTML (e.g. paulgraham.com)
          const idxRes = await fetch(indexUrl, {
            headers: { "User-Agent": "MAVIS/1.0" },
            signal: AbortSignal.timeout(15000),
          });
          const html = await idxRes.text();
          const hrefRe = /href=["']([^"'#?][^"']*?)["']/g;
          let m: RegExpExecArray | null;
          while ((m = hrefRe.exec(html)) !== null) rawLinks.push(m[1]);
        }

        // ── Step 2: Resolve, filter, deduplicate ─────────────────────────────

        const links = rawLinks
          .map(l => { try { return new URL(l, baseUrl).href; } catch { return ""; } })
          .filter(l => {
            if (!l || !l.startsWith("http")) return false;
            try {
              const u = new URL(l);
              if (u.host !== baseUrl.host) return false;
              if (u.pathname === baseUrl.pathname || u.pathname === "/") return false;
              if (linkPattern && !l.includes(linkPattern)) return false;
              return true;
            } catch { return false; }
          })
          .filter((l, i, arr) => arr.indexOf(l) === i)
          .slice(0, limitN);

        if (links.length === 0) {
          return json({
            error:        "No matching links found. Try removing link_pattern or check the index URL.",
            source_url:   indexUrl,
            raw_link_count: rawLinks.length,
          }, 400);
        }

        // ── Step 3: Scrape + summarize each article ───────────────────────────

        const summarize = async (articleUrl: string): Promise<Record<string, unknown>> => {
          let title   = "";
          let content = "";

          if (FC_KEY) {
            const d = await fcReq("/scrape", {
              url:             articleUrl,
              formats:         ["markdown"],
              onlyMainContent: true,
              excludeTags:     ["nav", "footer", "header", "aside", "script", "style"],
            });
            title   = d.data?.metadata?.title ?? "";
            content = d.data?.markdown ?? "";
          } else {
            const artRes = await fetch(articleUrl, {
              headers: { "User-Agent": "MAVIS/1.0" },
              signal: AbortSignal.timeout(15000),
            });
            const html    = await artRes.text();
            const titleM  = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            title   = titleM ? titleM[1].trim() : "";
            content = html.replace(/<script[\s\S]*?<\/script>/gi, "")
                          .replace(/<style[\s\S]*?<\/style>/gi, "")
                          .replace(/<[^>]+>/g, " ")
                          .replace(/\s+/g, " ")
                          .trim();
          }

          const wordCount   = content.split(/\s+/).filter(Boolean).length;
          const readingTime = Math.max(1, Math.ceil(wordCount / 200));
          const truncated   = content.slice(0, 8000);

          let summary = "(no summary — ANTHROPIC_API_KEY not set)";
          if (ANTHROPIC_KEY) {
            const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key":         ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
              },
              body: JSON.stringify({
                model:      "claude-haiku-4-5-20251001",
                max_tokens: 512,
                messages: [{
                  role:    "user",
                  content: `Title: ${title}\nURL: ${articleUrl}\n\n${truncated}\n\n---\n${summaryPrompt}`,
                }],
              }),
              signal: AbortSignal.timeout(20000),
            });
            const cd = await claudeRes.json();
            summary = cd.content?.[0]?.text ?? "";
          }

          return { url: articleUrl, title, summary, reading_time_minutes: readingTime, word_count: wordCount };
        };

        // Run in batches of 3 to avoid hammering servers
        const results: unknown[] = [];
        for (let i = 0; i < links.length; i += 3) {
          const batch   = links.slice(i, i + 3);
          const settled = await Promise.allSettled(batch.map(l => summarize(l)));
          settled.forEach((r, bi) => {
            if (r.status === "fulfilled") results.push(r.value);
            else results.push({ url: batch[bi], error: (r.reason as Error)?.message ?? "failed" });
          });
        }

        return json({ source_url: indexUrl, items: results, count: results.length, link_pattern: linkPattern || null });
      }

      default:
        return json({ error: `Unknown action: ${action}. Use: scrape | crawl | poll_crawl | map | search | extract | digest` }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-firecrawl-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
