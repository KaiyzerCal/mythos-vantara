import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function fail(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function verifyAuth(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return false;
  if (token === SB_KEY) return true;
  if (!SB_URL) return false;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SB_KEY } });
    return res.ok;
  } catch { return false; }
}

interface QuoteData {
  code: string; name: string; price: number; change: number;
  change_pct: number; volume?: number; market_cap?: number; market?: string;
  closes?: number[];
}

async function yahooQuote(symbol: string): Promise<QuoteData> {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=10d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Yahoo ${res.status}: ${symbol}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo data: ${symbol}`);
  const meta = result.meta;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? 0;
  const price = meta.regularMarketPrice ?? 0;
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((c: number | null) => c != null) as number[];
  return {
    code: symbol,
    name: meta.longName || meta.shortName || symbol,
    price, change: price - prev,
    change_pct: prev ? ((price - prev) / prev) * 100 : 0,
    volume: meta.regularMarketVolume,
    market_cap: meta.marketCap,
    market: meta.exchangeName,
    closes,
  };
}

function computeSignal(closes: number[]): { signal: "buy"|"sell"|"hold"|"watch"; strength: number; reason: string } {
  const valid = closes.filter(c => c != null && !isNaN(c));
  if (valid.length < 3) return { signal: "watch", strength: 0.5, reason: "Insufficient history" };
  const first = valid[0], last = valid[valid.length - 1];
  const change = (last - first) / first;
  const recent3 = valid.slice(-3);
  const trending = recent3[2] > recent3[1] && recent3[1] > recent3[0];
  if (change > 0.06 && trending) return { signal: "buy", strength: Math.min(change * 8, 1), reason: `+${(change*100).toFixed(1)}% momentum over ${valid.length} days` };
  if (change < -0.06) return { signal: "sell", strength: Math.min(-change * 8, 1), reason: `${(change*100).toFixed(1)}% decline over ${valid.length} days` };
  if (change > 0.02) return { signal: "watch", strength: 0.6, reason: `Mild uptrend +${(change*100).toFixed(1)}%` };
  return { signal: "hold", strength: 0.5, reason: `Flat ${(change*100).toFixed(1)}% over ${valid.length} days` };
}

const DEFAULT_WATCHLIST = ["AAPL","MSFT","GOOGL","NVDA","META","AMZN","TSLA","SPY","QQQ","BTC-USD"];

async function getWatchlist(sb: any): Promise<string[]> {
  const { data } = await sb.from("mavis_worldmonitor_cache").select("data").eq("cache_key","stock_watchlist").maybeSingle();
  return data?.data?.symbols ?? DEFAULT_WATCHLIST;
}

async function setWatchlist(sb: any, symbols: string[]): Promise<void> {
  await sb.from("mavis_worldmonitor_cache").upsert({
    cache_key: "stock_watchlist",
    data: { symbols },
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  }, { onConflict: "cache_key" });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await verifyAuth(req))) return fail("Unauthorized", 401);

  const sb = createClient(SB_URL, SB_KEY);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* no body */ }
  const action = String(body.action ?? "health");

  try {
    switch (action) {

      case "health":
        return ok({ ok: true, mode: "native", message: "Stock analysis via Yahoo Finance + Claude — no external server needed" });

      case "watchlist": {
        const symbols = await getWatchlist(sb);
        return ok({ watchlist: symbols });
      }

      case "watchlist_add": {
        const code = String(body.code ?? "").toUpperCase().trim();
        if (!code) return fail("code required", 400);
        const symbols = await getWatchlist(sb);
        if (!symbols.includes(code)) symbols.push(code);
        await setWatchlist(sb, symbols);
        return ok({ watchlist: symbols });
      }

      case "watchlist_remove": {
        const code = String(body.code ?? "").toUpperCase().trim();
        const symbols = (await getWatchlist(sb)).filter(s => s !== code);
        await setWatchlist(sb, symbols);
        return ok({ watchlist: symbols });
      }

      case "quote": {
        const code = String(body.code ?? "");
        if (!code) return fail("code required", 400);
        const q = await yahooQuote(code);
        return ok(q);
      }

      case "decision_signals": {
        const symbols = await getWatchlist(sb);
        const results = await Promise.allSettled(symbols.slice(0, 20).map(s => yahooQuote(s)));
        const signals = results
          .map((r, i) => {
            if (r.status !== "fulfilled") return null;
            const q = r.value;
            const s = computeSignal(q.closes ?? []);
            return { code: q.code, name: q.name, signal: s.signal, strength: s.strength, reason: s.reason, market: q.market };
          })
          .filter(Boolean);
        return ok({ signals });
      }

      case "analyze": {
        const stocks: string[] = Array.isArray(body.stocks) ? body.stocks : [String(body.stocks ?? "")];
        if (!stocks.length || !stocks[0]) return fail("stocks required", 400);
        const results = await Promise.allSettled(stocks.slice(0, 5).map(s => yahooQuote(s)));
        const valid = results.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<QuoteData>).value);
        if (!valid.length) return fail("Could not fetch quote data", 502);

        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey) {
          const q = valid[0];
          const sig = computeSignal(q.closes ?? []);
          return ok({ stock: q.code, summary: `${q.name} is currently trading at $${q.price?.toFixed(2)} (${q.change_pct > 0 ? "+" : ""}${q.change_pct?.toFixed(2)}%). Momentum signal: ${sig.signal}. ${sig.reason}.`, recommendation: sig.signal, confidence: sig.strength, target_price: null, risk_level: "medium", key_points: [sig.reason, `Volume: ${q.volume?.toLocaleString() ?? "N/A"}`, `Market: ${q.market ?? "N/A"}`] });
        }

        const stockList = valid.map(q => `${q.code} (${q.name}): $${q.price?.toFixed(2)}, ${q.change_pct > 0 ? "+" : ""}${q.change_pct?.toFixed(2)}% today, ${q.closes?.length ?? 0} days of data`).join("\n");
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: [{ role: "user", content: `Analyze these stocks for an investment outlook. Be concise and direct.\n\n${stockList}\n\nRespond in JSON only:\n{"stock":"${stocks[0]}","summary":"2-3 sentence analysis with price context","recommendation":"buy|sell|hold","confidence":0.0-1.0,"target_price":number_or_null,"risk_level":"low|medium|high","key_points":["point1","point2","point3"]}` }] })
        });
        const claudeData = await claudeRes.json();
        const text = claudeData?.content?.[0]?.text ?? "";
        const match = text.match(/\{[\s\S]*\}/);
        return ok(match ? JSON.parse(match[0]) : { raw: text });
      }

      case "intelligence": {
        const { data: cached } = await sb.from("mavis_worldmonitor_cache").select("data,expires_at").eq("cache_key","stock_intelligence").maybeSingle();
        if (cached && new Date(cached.expires_at) > new Date()) return ok(cached.data);

        const marketTickers = ["^GSPC","^IXIC","^DJI","^VIX","GC=F","CL=F","BTC-USD","ETH-USD"];
        const results = await Promise.allSettled(marketTickers.map(s => yahooQuote(s)));
        const valid = results.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<QuoteData>).value);

        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey || !valid.length) {
          const brief = { summary: "Market data fetched. Claude API key required for AI synthesis.", sentiment: "neutral", highlights: valid.map(q => `${q.name || q.code}: $${q.price?.toFixed(2)} (${q.change_pct > 0 ? "+" : ""}${q.change_pct?.toFixed(2)}%)`), updated_at: new Date().toISOString() };
          return ok(brief);
        }

        const marketStr = valid.map(q => `${q.name || q.code}: $${q.price?.toFixed(2)} (${q.change_pct > 0 ? "+" : ""}${q.change_pct?.toFixed(2)}%)`).join("\n");
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, messages: [{ role: "user", content: `Current market data:\n${marketStr}\n\nWrite a brief market intelligence report.\n\nJSON only:\n{"summary":"2-3 sentences on overall market condition","sentiment":"bullish|bearish|neutral|mixed","highlights":["key point 1","key point 2","key point 3"],"updated_at":"${new Date().toISOString()}"}` }] })
        });
        const claudeData = await claudeRes.json();
        const text = claudeData?.content?.[0]?.text ?? "";
        const match = text.match(/\{[\s\S]*\}/);
        const result = match ? JSON.parse(match[0]) : { summary: "Analysis unavailable", sentiment: "neutral", highlights: [], updated_at: new Date().toISOString() };
        await sb.from("mavis_worldmonitor_cache").upsert({ cache_key: "stock_intelligence", data: result, fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1800000).toISOString() }, { onConflict: "cache_key" });
        return ok(result);
      }

      case "market_review": {
        const symbols = ["^GSPC","^IXIC","^DJI","GC=F","CL=F","BTC-USD"];
        const results = await Promise.allSettled(symbols.map(s => yahooQuote(s)));
        const valid = results.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<QuoteData>).value);
        const summary = valid.map(q => `${q.name || q.code}: $${q.price?.toFixed(2)} (${q.change_pct > 0 ? "+" : ""}${q.change_pct?.toFixed(2)}%)`).join(" | ");
        return ok({ report: `Market Review — ${new Date().toLocaleDateString()}\n\n${summary}` });
      }

      default:
        return fail(`Unknown action: ${action}`, 400);
    }
  } catch (e: any) {
    return fail(`Error: ${e?.message ?? String(e)}`, 500);
  }
});
