// mavis-polymarket — Live Polymarket prediction market data
// Actions: search | get | trending
// Uses Gamma API (free, no auth required for reads)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL  = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GAMMA   = "https://gamma-api.polymarket.com";

async function getUser(authHeader: string) {
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  const { data: { user }, error } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
  return { user, error };
}

function formatMarket(m: any) {
  let outcomes: string[] = [];
  let prices: number[] = [];
  try { outcomes = JSON.parse(m.outcomes ?? "[]"); } catch {}
  try { prices = JSON.parse(m.outcomePrices ?? "[]").map(Number); } catch {}

  return {
    id: m.conditionId ?? m.id,
    question: m.question,
    category: m.category ?? null,
    outcomes: outcomes.map((name: string, i: number) => ({
      name,
      probability: prices[i] ?? null,
    })),
    volume_usd: parseFloat(m.volume ?? "0"),
    liquidity_usd: parseFloat(m.liquidity ?? "0"),
    end_date: m.endDate ?? null,
    active: m.active ?? false,
    closed: m.closed ?? false,
    resolved: m.resolved ?? false,
    url: `https://polymarket.com/event/${m.slug ?? m.conditionId}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { user, error: authErr } = await getUser(authHeader);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "trending";

    // ── SEARCH ────────────────────────────────────────────
    if (action === "search") {
      const query: string = body.query ?? "";
      if (!query) {
        return new Response(JSON.stringify({ error: "query required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const params = new URLSearchParams({
        search_term: query,
        limit: String(Math.min(body.limit ?? 10, 20)),
        active: "true",
        closed: "false",
        order: "volume",
        ascending: "false",
      });

      const res = await fetch(`${GAMMA}/markets?${params}`);
      if (!res.ok) throw new Error(`Polymarket API ${res.status}`);
      const markets: any[] = await res.json();

      return new Response(JSON.stringify({
        ok: true,
        query,
        count: markets.length,
        markets: markets.map(formatMarket),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── GET ───────────────────────────────────────────────
    if (action === "get") {
      const id: string = body.market_id ?? body.id ?? "";
      if (!id) {
        return new Response(JSON.stringify({ error: "market_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch(`${GAMMA}/markets/${id}`);
      if (!res.ok) throw new Error(`Market not found: ${id}`);
      const market = await res.json();

      return new Response(JSON.stringify({
        ok: true,
        market: formatMarket(market),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── TRENDING ──────────────────────────────────────────
    if (action === "trending") {
      const params = new URLSearchParams({
        limit: "15",
        active: "true",
        closed: "false",
        order: "volume",
        ascending: "false",
      });

      const res = await fetch(`${GAMMA}/markets?${params}`);
      if (!res.ok) throw new Error(`Polymarket API ${res.status}`);
      const markets: any[] = await res.json();

      return new Response(JSON.stringify({
        ok: true,
        count: markets.length,
        markets: markets.map(formatMarket),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("mavis-polymarket error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
