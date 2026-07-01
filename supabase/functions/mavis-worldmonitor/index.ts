import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const COUNTRY_COORDS: Record<string, [number, number]> = {
  US:[37.09,-95.71],RU:[61.52,105.32],CN:[35.86,104.19],DE:[51.17,10.45],
  GB:[55.38,-3.44],FR:[46.23,2.21],JP:[36.20,138.25],IN:[20.59,78.96],
  BR:[-14.24,-51.93],AU:[-25.27,133.78],CA:[56.13,-106.35],MX:[23.63,-102.55],
  IT:[41.87,12.57],ES:[40.46,-3.75],KR:[35.91,127.77],AR:[-38.42,-63.62],
  ZA:[-30.56,22.94],NG:[9.08,8.68],EG:[26.82,30.80],SA:[23.89,45.08],
  UA:[48.38,31.17],IL:[31.05,34.85],IR:[32.43,53.69],TR:[38.96,35.24],
  PK:[30.38,69.35],ID:[-0.79,113.92],TH:[15.87,100.99],VN:[14.06,108.28],
  PH:[12.88,121.77],MM:[21.91,95.96],ET:[9.15,40.49],SD:[12.86,30.22],
  LY:[26.34,17.23],SY:[34.80,38.99],IQ:[33.22,43.68],AF:[33.93,67.71],
  YE:[15.55,48.52],SO:[5.15,46.20],CD:[-4.04,21.76],VE:[6.42,-66.59],
  NL:[52.13,5.29],PL:[51.92,19.15],SE:[60.13,18.64],NO:[60.47,8.47],
  CH:[46.82,8.23],AT:[47.52,14.55],BE:[50.50,4.47],PT:[39.40,-8.22],
  GR:[39.07,21.82],NZ:[-40.90,174.89],PS:[31.95,35.23],LB:[33.85,35.86],
  KZ:[48.02,66.92],UZ:[41.38,64.59],GE:[42.31,43.36],AZ:[40.14,47.58],
  BY:[53.71,27.95],RS:[44.02,21.01],RO:[45.94,24.97],HU:[47.16,19.50],
};

const CATEGORY_COLORS: Record<string, string> = {
  earthquake:"#f97316",disaster:"#ef4444",conflict:"#dc2626",climate:"#3b82f6",
  aviation:"#06b6d4",maritime:"#8b5cf6",news:"#eab308",market:"#22c55e",
};
const SEVERITY_SIZE: Record<string, number> = { low:0.3, medium:0.5, high:0.8, critical:1.2 };

async function getCache(sb: any, key: string): Promise<any | null> {
  const { data } = await sb.from("mavis_worldmonitor_cache").select("data, expires_at").eq("cache_key", key).maybeSingle();
  if (data && new Date(data.expires_at) > new Date()) return data.data;
  return null;
}

async function setCache(sb: any, key: string, payload: any, ttlSec: number) {
  await sb.from("mavis_worldmonitor_cache").upsert({
    cache_key: key, data: payload,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  }, { onConflict: "cache_key" });
}

async function safeFetch(url: string, opts: RequestInit = {}): Promise<any | null> {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function parseGdeltDate(s: string): string {
  // format: 20240101T120000Z
  try {
    const year = s.slice(0,4), month = s.slice(4,6), day = s.slice(6,8);
    const hour = s.slice(9,11), min = s.slice(11,13), sec = s.slice(13,15);
    return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
  } catch { return new Date().toISOString(); }
}

function jitter(): number { return (Math.random() - 0.5) * 2; }

// --- globe_events ---
async function handleGlobeEvents(sb: any): Promise<any> {
  const cached = await getCache(sb, "globe_events");
  // Normalise: old cache entries stored the raw array; new ones store { events }
  if (cached) return json(Array.isArray(cached) ? { events: cached } : cached);

  const [usgsRes, eonetRes, gdeltRes] = await Promise.allSettled([
    safeFetch("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=4.5&limit=50&orderby=time"),
    safeFetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30&days=14"),
    safeFetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&query=conflict+war+geopolitics+military+sanctions&maxrecords=20&sort=DateDesc&language=English"),
  ]);

  const events: any[] = [];

  // USGS Earthquakes
  if (usgsRes.status === "fulfilled" && usgsRes.value?.features) {
    for (const f of usgsRes.value.features) {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const mag = p.mag ?? 0;
      const severity = mag >= 7 ? "critical" : mag >= 6 ? "high" : mag >= 5 ? "medium" : "low";
      events.push({
        id: `usgs-${f.id}`,
        lat, lng,
        category: "earthquake",
        title: `M${mag.toFixed(1)} ${p.place}`,
        description: `Magnitude ${mag} earthquake`,
        severity,
        magnitude: mag,
        url: p.url,
        timestamp: new Date(p.time).toISOString(),
        color: CATEGORY_COLORS.earthquake,
        size: SEVERITY_SIZE[severity],
      });
    }
  }

  // NASA EONET
  if (eonetRes.status === "fulfilled" && eonetRes.value?.events) {
    for (const e of eonetRes.value.events) {
      const geo = e.geometries?.[0];
      if (!geo?.coordinates) continue;
      const [lng, lat] = geo.coordinates;
      const catTitle = (e.categories?.[0]?.title ?? "").toLowerCase();
      let category = "disaster";
      if (catTitle.includes("wildfire") || catTitle.includes("volcano")) category = "disaster";
      else if (catTitle.includes("storm") || catTitle.includes("drought")) category = "climate";
      events.push({
        id: `eonet-${e.id}`,
        lat, lng,
        category,
        title: e.title,
        description: e.categories?.[0]?.title,
        severity: "medium",
        url: e.sources?.[0]?.url,
        timestamp: geo.date ?? new Date().toISOString(),
        color: CATEGORY_COLORS[category],
        size: SEVERITY_SIZE.medium,
      });
    }
  }

  // GDELT
  if (gdeltRes.status === "fulfilled" && gdeltRes.value?.articles) {
    for (const a of gdeltRes.value.articles) {
      const cc = (a.sourcecountry ?? "").toUpperCase();
      const coords = COUNTRY_COORDS[cc];
      if (!coords) continue;
      const [lat, lng] = coords;
      events.push({
        id: `gdelt-${encodeURIComponent(a.url ?? a.title ?? Math.random())}`,
        lat: lat + jitter(),
        lng: lng + jitter(),
        category: "news",
        title: a.title,
        description: a.domain,
        severity: "low",
        url: a.url,
        timestamp: a.seendate ? parseGdeltDate(a.seendate) : new Date().toISOString(),
        color: CATEGORY_COLORS.news,
        size: SEVERITY_SIZE.low,
      });
    }
  }

  const payload = { events };
  await setCache(sb, "globe_events", payload, 900);
  return json(payload);
}

// --- news_brief ---
async function handleNewsBrief(sb: any): Promise<any> {
  const cached = await getCache(sb, "news_brief");
  if (cached) return json(cached);

  const queries = ["conflict war military", "economy sanctions trade", "geopolitics diplomacy nato"];
  const results = await Promise.allSettled(
    queries.map(q => safeFetch(`https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&query=${encodeURIComponent(q)}&maxrecords=20&sort=DateDesc&language=English`))
  );

  const seen = new Set<string>();
  const articles: any[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value?.articles) continue;
    for (const a of r.value.articles) {
      const key = (a.title ?? "").slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(a);
    }
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey || articles.length === 0) {
    const fallback = { headline: "No data available", body: "Could not fetch intelligence data at this time.", risk_level: "low", key_themes: [], generated_at: new Date().toISOString() };
    return json(fallback);
  }

  const articleList = articles.slice(0, 30).map(a =>
    `- ${a.title} [${a.domain}, ${a.sourcecountry}, ${a.seendate ? parseGdeltDate(a.seendate) : "unknown"}]`
  ).join("\n");

  const prompt = `You are MAVIS, a global intelligence analyst. Synthesize these recent news articles into a concise intelligence brief for the operator.\n\nArticles:\n${articleList}\n\nRespond in JSON only:\n{\n  "headline": "One sentence capturing the most critical global development",\n  "body": "Three paragraphs: (1) geopolitical landscape, (2) economic/market context, (3) emerging risks or opportunities",\n  "risk_level": "low|moderate|elevated|high|critical",\n  "key_themes": ["array", "of", "3-5", "themes"]\n}`;

  let brief: any = null;
  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
    });
    const claudeData = await claudeRes.json();
    const text = claudeData?.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (match) brief = JSON.parse(match[0]);
  } catch { /* fall through */ }

  if (!brief) {
    brief = { headline: "Intelligence synthesis unavailable", body: "Claude synthesis failed. Raw data was fetched but could not be processed.", risk_level: "low", key_themes: [] };
  }

  const result = { ...brief, generated_at: new Date().toISOString() };
  await setCache(sb, "news_brief", result, 3600);
  return json(result);
}

// --- market_brief ---
async function handleMarketBrief(sb: any): Promise<any> {
  const cached = await getCache(sb, "market_brief");
  if (cached) return json(cached);

  const yahooSymbols: Array<{ encoded: string; symbol: string; name: string; type: "index" | "commodity" }> = [
    { encoded: "%5EGSPC", symbol: "SPX",  name: "S&P 500",  type: "index" },
    { encoded: "%5EIXIC", symbol: "NDX",  name: "NASDAQ",   type: "index" },
    { encoded: "%5EDJI",  symbol: "DJIA", name: "Dow Jones", type: "index" },
    { encoded: "GC%3DF",  symbol: "GOLD", name: "Gold",     type: "commodity" },
    { encoded: "CL%3DF",  symbol: "OIL",  name: "Oil",      type: "commodity" },
  ];

  const [geckoRes, ...yahooResults] = await Promise.allSettled([
    safeFetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple&vs_currencies=usd&include_24hr_change=true"),
    ...yahooSymbols.map(s => safeFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s.encoded}?interval=1d&range=1d`, { headers: { "User-Agent": "Mozilla/5.0" } })),
  ]);

  const ticks: any[] = [];

  // Crypto
  if (geckoRes.status === "fulfilled" && geckoRes.value) {
    const g = geckoRes.value;
    const coins = [
      { id: "bitcoin",  symbol: "BTC", name: "Bitcoin"  },
      { id: "ethereum", symbol: "ETH", name: "Ethereum" },
      { id: "solana",   symbol: "SOL", name: "Solana"   },
      { id: "ripple",   symbol: "XRP", name: "XRP"      },
    ];
    for (const c of coins) {
      const d = g[c.id];
      if (!d) continue;
      ticks.push({ symbol: c.symbol, name: c.name, price: d.usd, change24h: d.usd_24h_change ?? null, currency: "USD", type: "crypto" });
    }
  }

  // Yahoo Finance
  for (let i = 0; i < yahooResults.length; i++) {
    const r = yahooResults[i];
    if (r.status !== "fulfilled" || !r.value) continue;
    const meta = r.value?.chart?.result?.[0]?.meta;
    if (!meta) continue;
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose;
    const change = prev && price ? ((price - prev) / prev) * 100 : null;
    const s = yahooSymbols[i];
    ticks.push({ symbol: s.symbol, name: s.name, price, change24h: change, currency: "USD", type: s.type });
  }

  const result = { ticks, fetched_at: new Date().toISOString() };
  await setCache(sb, "market_brief", result, 300);
  return json(result);
}

// --- country_brief ---
async function handleCountryBrief(sb: any, country: string): Promise<any> {
  if (!country) return err("country param required");

  const gdeltData = await safeFetch(
    `https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&query=${encodeURIComponent(`"${country}"`)}&maxrecords=20&sort=DateDesc&language=English`
  );

  const articles = gdeltData?.articles ?? [];
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!apiKey) {
    return json({ country, brief: "No Claude API key configured.", risk_level: "low", sources: [] });
  }

  const articleList = articles.slice(0, 20).map((a: any) =>
    `- ${a.title} [${a.domain}, ${a.seendate ? parseGdeltDate(a.seendate) : "unknown"}]`
  ).join("\n") || "No recent articles found.";

  const prompt = `You are MAVIS, a global intelligence analyst. Write a concise 2-paragraph brief about ${country}'s current situation based on these recent news articles.\n\nArticles:\n${articleList}\n\nRespond in JSON only:\n{\n  "brief": "Two paragraphs about current situation and risks",\n  "risk_level": "low|moderate|elevated|high|critical"\n}`;

  let brief = "No brief available.";
  let risk_level = "low";

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 512, messages: [{ role: "user", content: prompt }] }),
    });
    const claudeData = await claudeRes.json();
    const text = claudeData?.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      brief = parsed.brief ?? brief;
      risk_level = parsed.risk_level ?? risk_level;
    }
  } catch { /* fall through */ }

  const sources = articles.slice(0, 10).map((a: any) => ({ title: a.title, url: a.url, domain: a.domain }));
  return json({ country, brief, risk_level, sources });
}

// --- main handler ---
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const url = new URL(req.url);
  let body: any = {};
  try {
    if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
      body = await req.json();
    }
  } catch { /* ignore */ }

  const action = url.searchParams.get("action") ?? body.action ?? "globe_events";

  try {
    if (action === "globe_events") return await handleGlobeEvents(sb);
    if (action === "news_brief") return await handleNewsBrief(sb);
    if (action === "market_brief") return await handleMarketBrief(sb);
    if (action === "country_brief") {
      const country = url.searchParams.get("country") ?? body.country ?? "";
      return await handleCountryBrief(sb, country);
    }
    return err(`Unknown action: ${action}`);
  } catch (e: any) {
    return err(`Internal error: ${e?.message ?? "unknown"}`, 500);
  }
});
