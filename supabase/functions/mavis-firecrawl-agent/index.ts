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

      default:
        return json({ error: `Unknown action: ${action}. Use: scrape | crawl | poll_crawl | map | search | extract` }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-firecrawl-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
