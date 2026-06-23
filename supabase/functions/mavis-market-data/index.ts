// MAVIS Market Data — real-time stocks, crypto, and forex prices.
// Uses CoinGecko (crypto, free/no key) and Yahoo Finance unofficial API (stocks, free/no key).
// No API keys required for basic usage.
// Optional: ALPHA_VANTAGE_KEY for enhanced stock data (500 req/day free).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALPHA_VANTAGE_KEY = Deno.env.get("ALPHA_VANTAGE_KEY") ?? "";

// ── Crypto via CoinGecko (no key needed) ──────────────────────────────────────
async function getCryptoPrice(coinIds: string[]): Promise<Record<string, unknown>> {
  const ids = coinIds.join(",");
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  return res.json();
}

// Map common crypto symbols to CoinGecko IDs
const CRYPTO_SYMBOL_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", DOT: "polkadot",
  MATIC: "matic-network", AVAX: "avalanche-2", LINK: "chainlink",
  UNI: "uniswap", ATOM: "cosmos", LTC: "litecoin", BCH: "bitcoin-cash",
};

// ── Stocks via Yahoo Finance (no key needed) ──────────────────────────────────
async function getStockPrice(symbols: string[]): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${sym.toUpperCase()}?interval=1d&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) { results[sym] = { error: `HTTP ${res.status}` }; return; }
      const d = await res.json();
      const meta = d.chart?.result?.[0]?.meta;
      if (!meta) { results[sym] = { error: "No data" }; return; }
      results[sym] = {
        symbol: meta.symbol,
        price: meta.regularMarketPrice,
        previousClose: meta.previousClose ?? meta.chartPreviousClose,
        change: meta.regularMarketPrice - (meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPrice),
        changePercent: ((meta.regularMarketPrice - (meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPrice)) / (meta.previousClose ?? meta.regularMarketPrice) * 100).toFixed(2),
        currency: meta.currency,
        exchange: meta.exchangeName,
        marketState: meta.marketState,
      };
    } catch (e: any) {
      results[sym] = { error: e.message };
    }
  }));
  return results;
}

// ── Alpha Vantage (enhanced stock data, 500 req/day free) ─────────────────────
async function getAlphaVantageQuote(symbol: string): Promise<Record<string, unknown> | null> {
  if (!ALPHA_VANTAGE_KEY) return null;
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const d = await res.json();
    const q = d["Global Quote"];
    if (!q?.["05. price"]) return null;
    return {
      symbol: q["01. symbol"],
      price: parseFloat(q["05. price"]),
      change: parseFloat(q["09. change"]),
      changePercent: q["10. change percent"],
      volume: parseInt(q["06. volume"]),
      previousClose: parseFloat(q["08. previous close"]),
      high: parseFloat(q["03. high"]),
      low: parseFloat(q["04. low"]),
    };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const type    = String(body.type ?? "stock").toLowerCase(); // stock | crypto | mixed
    const symbols = (body.symbols as string[] | undefined)?.map((s) => s.trim().toUpperCase()) ?? [];

    if (!symbols.length) {
      return new Response(JSON.stringify({ error: "symbols array is required. E.g. { type: 'crypto', symbols: ['BTC','ETH'] }" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let data: Record<string, unknown> = {};
    let provider = "";

    if (type === "crypto") {
      const coinIds = symbols.map((s) => CRYPTO_SYMBOL_MAP[s] ?? s.toLowerCase());
      data = await getCryptoPrice(coinIds);
      provider = "coingecko";
    } else if (type === "stock") {
      // Try Alpha Vantage if available and single symbol
      if (ALPHA_VANTAGE_KEY && symbols.length === 1) {
        const av = await getAlphaVantageQuote(symbols[0]);
        if (av) { data[symbols[0]] = av; provider = "alpha-vantage"; }
      }
      if (!Object.keys(data).length) {
        data = await getStockPrice(symbols);
        provider = "yahoo-finance";
      }
    } else {
      // Mixed: detect crypto vs stock by symbol
      const cryptoSyms = symbols.filter((s) => CRYPTO_SYMBOL_MAP[s]);
      const stockSyms  = symbols.filter((s) => !CRYPTO_SYMBOL_MAP[s]);
      if (cryptoSyms.length) {
        const coinIds = cryptoSyms.map((s) => CRYPTO_SYMBOL_MAP[s]);
        const cd = await getCryptoPrice(coinIds);
        Object.assign(data, cd);
      }
      if (stockSyms.length) {
        const sd = await getStockPrice(stockSyms);
        Object.assign(data, sd);
      }
      provider = "coingecko+yahoo-finance";
    }

    return new Response(
      JSON.stringify({ data, provider, timestamp: new Date().toISOString(), symbols }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
