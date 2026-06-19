// mavis-exa-agent
// Neural semantic search via Exa AI — finds content by MEANING, not keywords.
// Far superior to keyword search for research, competitor analysis, lead finding.
// Requires: EXA_API_KEY
//
// Actions: search | find_similar | get_contents | search_news | search_research

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXA_KEY = Deno.env.get("EXA_API_KEY") ?? "";
const EXA_API = "https://api.exa.ai";

function requireExa() {
  if (!EXA_KEY) throw new Error("Exa not configured. Set EXA_API_KEY in Supabase secrets.");
}

async function exaReq(path: string, body: Record<string, unknown>): Promise<any> {
  requireExa();
  const res = await fetch(`${EXA_API}${path}`, {
    method: "POST",
    headers: { "x-api-key": EXA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Exa API error (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function cleanResults(results: any[]): any[] {
  return results.map(r => ({
    title:       r.title,
    url:         r.url,
    published:   r.publishedDate,
    author:      r.author,
    score:       r.score,
    snippet:     r.text?.slice(0, 500) ?? r.highlights?.[0] ?? "",
    highlights:  r.highlights?.slice(0, 3) ?? [],
  }));
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

    const body    = await req.json().catch(() => ({}));
    const action  = String(body.action ?? "search");
    const numResults = Math.min(Number(body.num_results ?? body.limit ?? 10), 25);

    switch (action) {
      case "search": {
        const query = String(body.query ?? "");
        if (!query) return json({ error: "query required" }, 400);

        const data = await exaReq("/search", {
          query,
          numResults,
          type:           body.type ?? "auto",           // auto | neural | keyword
          useAutoprompt:  body.autoprompt !== false,
          includeDomains: body.include_domains ?? [],
          excludeDomains: body.exclude_domains ?? [],
          startPublishedDate: body.start_date,
          endPublishedDate:   body.end_date,
          contents: {
            text:       { maxCharacters: 800 },
            highlights: { numSentences: 2, highlightsPerUrl: 2 },
          },
        });

        return json({ results: cleanResults(data.results ?? []), total: data.results?.length ?? 0, query });
      }

      case "find_similar": {
        const url = String(body.url ?? "");
        if (!url) return json({ error: "url required" }, 400);

        const data = await exaReq("/findSimilar", {
          url,
          numResults,
          excludeSourceDomain: body.exclude_source !== false,
          contents: { text: { maxCharacters: 600 }, highlights: { numSentences: 2, highlightsPerUrl: 2 } },
        });

        return json({ results: cleanResults(data.results ?? []), seed_url: url });
      }

      case "get_contents": {
        const urls = Array.isArray(body.urls) ? body.urls as string[] : [String(body.url ?? "")];
        if (!urls.length || !urls[0]) return json({ error: "urls[] or url required" }, 400);

        const data = await exaReq("/contents", {
          ids: urls,
          contents: {
            text:       body.full_text ? true : { maxCharacters: 2000 },
            highlights: { numSentences: 3, highlightsPerUrl: 3 },
            summary:    { query: body.summary_query ?? "key points and main takeaways" },
          },
        });

        return json({ contents: (data.results ?? []).map((r: any) => ({
          url:       r.url,
          title:     r.title,
          text:      r.text?.slice(0, 3000),
          summary:   r.summary,
          highlights: r.highlights,
          published: r.publishedDate,
        }))});
      }

      case "search_news": {
        const query = String(body.query ?? "");
        if (!query) return json({ error: "query required" }, 400);

        const startDate = body.start_date ?? new Date(Date.now() - 7 * 86_400_000).toISOString().split("T")[0];
        const data = await exaReq("/search", {
          query,
          numResults,
          type: "keyword",
          useAutoprompt: false,
          startPublishedDate: startDate,
          includeDomains: body.sources ?? [],
          contents: { text: { maxCharacters: 600 }, highlights: { numSentences: 2, highlightsPerUrl: 2 } },
        });

        return json({ articles: cleanResults(data.results ?? []), query, since: startDate });
      }

      case "search_research": {
        // Optimized for academic/research content
        const query = String(body.query ?? "");
        if (!query) return json({ error: "query required" }, 400);

        const data = await exaReq("/search", {
          query: `research paper academic study: ${query}`,
          numResults,
          type: "neural",
          useAutoprompt: true,
          includeDomains: ["arxiv.org", "scholar.google.com", "pubmed.ncbi.nlm.nih.gov", "ssrn.com", "researchgate.net"],
          contents: { text: { maxCharacters: 1000 }, summary: { query: "main findings and methodology" } },
        });

        return json({ papers: cleanResults(data.results ?? []), query });
      }

      default:
        return json({ error: `Unknown action: ${action}. Use: search | find_similar | get_contents | search_news | search_research` }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-exa-agent]", message);
    return json({ error: message }, message.includes("not configured") ? 503 : 500);
  }
});
