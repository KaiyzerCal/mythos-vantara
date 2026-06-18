// mavis-sec-agent
// SEC EDGAR API — free, no auth required. Pull public company filings,
// financial facts, insider trades, and 10-K/10-Q data.
//
// Actions: search_company | get_filings | get_facts | get_insider_trades | get_filing_text

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_SRK     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEC_HEADERS = { "User-Agent": "MAVIS/1.0 contact@mavis.ai" }; // SEC requires User-Agent

async function secGet(url: string): Promise<any> {
  const res = await fetch(url, { headers: SEC_HEADERS });
  if (!res.ok) throw new Error(`SEC API error (${res.status}): ${url}`);
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("json") ? res.json() : res.text();
}

function padCik(cik: string | number): string {
  return String(cik).padStart(10, "0");
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
    const action = String(body.action ?? "search_company");

    switch (action) {
      case "search_company": {
        // Search by name or ticker
        const query = String(body.query ?? body.name ?? body.ticker ?? "");
        if (!query) return json({ error: "query required" }, 400);

        const data = await secGet(
          `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&dateRange=custom&startdt=2020-01-01&forms=10-K`
        );

        // Also try the company search endpoint
        const companyData = await secGet(
          `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&entity=${encodeURIComponent(query)}`
        ).catch(() => ({ hits: { hits: [] } }));

        // Get CIK from company tickers JSON (fast lookup)
        const tickerData = await secGet("https://www.sec.gov/files/company_tickers.json").catch(() => ({}));
        const ticker     = query.toUpperCase();
        const tickerMatch = Object.values(tickerData as Record<string, any>).find(
          (c: any) => c.ticker === ticker || c.title?.toLowerCase().includes(query.toLowerCase())
        );

        return json({
          query,
          cik:     tickerMatch?.cik_str ? padCik(tickerMatch.cik_str) : null,
          ticker:  tickerMatch?.ticker ?? null,
          name:    tickerMatch?.title ?? null,
          edgar_url: tickerMatch?.cik_str
            ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${tickerMatch.cik_str}&type=10-K`
            : null,
          filings_preview: (data as any)?.hits?.hits?.slice(0, 3).map((h: any) => ({
            form:      h._source?.form_type,
            date:      h._source?.period_of_report,
            entity:    h._source?.entity_name,
            accession: h._id,
          })) ?? [],
        });
      }

      case "get_filings": {
        const cik   = padCik(String(body.cik ?? ""));
        const type  = String(body.form_type ?? "10-K"); // 10-K | 10-Q | 8-K | DEF 14A | SC 13G
        const limit = Math.min(Number(body.limit ?? 10), 40);

        if (!cik || cik === "0000000000") return json({ error: "cik required" }, 400);

        const data = await secGet(`https://data.sec.gov/submissions/CIK${cik}.json`);
        const filings = data.filings?.recent;
        if (!filings) return json({ error: "No filings found" }, 404);

        const indices: number[] = [];
        for (let i = 0; i < (filings.form?.length ?? 0) && indices.length < limit; i++) {
          if (type === "all" || filings.form[i] === type) indices.push(i);
        }

        return json({
          cik,
          company_name: data.name,
          ticker:       data.tickers?.[0],
          filings: indices.map(i => ({
            form:       filings.form[i],
            date:       filings.filingDate[i],
            accession:  filings.accessionNumber[i],
            period:     filings.reportDate[i],
            url:        `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${filings.accessionNumber[i].replace(/-/g, "")}/`,
          })),
        });
      }

      case "get_facts": {
        // XBRL financial facts — revenue, assets, EPS, etc.
        const cik  = padCik(String(body.cik ?? ""));
        const fact = String(body.fact ?? "Revenue"); // e.g. Revenue, NetIncomeLoss, Assets
        if (!cik || cik === "0000000000") return json({ error: "cik required" }, 400);

        const data = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
        const usGaap = data.facts?.["us-gaap"] ?? {};

        if (fact === "all") {
          return json({ cik, facts_available: Object.keys(usGaap).slice(0, 50) });
        }

        const factData = usGaap[fact];
        if (!factData) return json({ error: `Fact '${fact}' not found. Try fact=all to list available facts.` }, 404);

        const units = Object.entries(factData.units ?? {})[0] as [string, any[]];
        const recent = (units?.[1] ?? [])
          .filter((v: any) => v.form === "10-K" || v.form === "10-Q")
          .sort((a: any, b: any) => b.end?.localeCompare(a.end ?? "") ?? 0)
          .slice(0, Number(body.limit ?? 8));

        return json({
          cik,
          fact,
          unit:   units?.[0],
          label:  factData.label,
          values: recent.map((v: any) => ({ period: v.end, value: v.val, form: v.form, filed: v.filed })),
        });
      }

      case "get_insider_trades": {
        // Form 4 — insider buy/sell transactions
        const cik   = padCik(String(body.cik ?? ""));
        const limit = Math.min(Number(body.limit ?? 20), 40);
        if (!cik || cik === "0000000000") return json({ error: "cik required" }, 400);

        const data    = await secGet(`https://data.sec.gov/submissions/CIK${cik}.json`);
        const filings = data.filings?.recent;
        if (!filings) return json({ error: "No filings found" }, 404);

        const trades: any[] = [];
        for (let i = 0; i < (filings.form?.length ?? 0) && trades.length < limit; i++) {
          if (filings.form[i] === "4") {
            trades.push({
              date:      filings.filingDate[i],
              accession: filings.accessionNumber[i],
              url:       `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${filings.accessionNumber[i].replace(/-/g, "")}/`,
            });
          }
        }

        return json({ cik, company_name: data.name, insider_trades: trades });
      }

      case "get_filing_text": {
        // Fetch and truncate text of a specific filing
        const url = String(body.url ?? "");
        if (!url) return json({ error: "url required (from get_filings)" }, 400);

        const text = await secGet(url) as string;
        const cleaned = typeof text === "string"
          ? text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, Number(body.max_chars ?? 5000))
          : JSON.stringify(text).slice(0, 5000);

        return json({ url, text: cleaned, char_count: cleaned.length });
      }

      default:
        return json({ error: `Unknown action: ${action}. Use: search_company | get_filings | get_facts | get_insider_trades | get_filing_text` }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-sec-agent]", message);
    return json({ error: message }, 500);
  }
});
