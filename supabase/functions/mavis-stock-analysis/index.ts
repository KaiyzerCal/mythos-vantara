import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = Deno.env.get("STOCK_ANALYSIS_URL") ?? "http://localhost:8000";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 500) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Verify caller is authenticated (user JWT or service role)
async function verifyAuth(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return false;
  if (token === SERVICE_ROLE) return true;
  if (!SUPABASE_URL) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function proxyGet(path: string, timeout = 30000) {
  const res = await fetch(`${BASE_URL}${path}`, {
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}: ${path}`);
  return res.json();
}

async function proxyPost(path: string, body: unknown, timeout = 120000) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status}: ${text || path}`);
  }
  return res.json();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await verifyAuth(req))) return err("Unauthorized", 401);

  let action: string;
  let params: Record<string, unknown>;

  try {
    const body = await req.json();
    action = String(body.action ?? "health");
    params = (body.params ?? body) as Record<string, unknown>;
  } catch {
    return err("Invalid JSON", 400);
  }

  // Health check — always available, tests connectivity
  if (action === "health") {
    const configured = !!Deno.env.get("STOCK_ANALYSIS_URL");
    try {
      await proxyGet("/", 5000);
      return ok({ ok: true, url: BASE_URL, configured });
    } catch (e) {
      return ok({
        ok: false,
        url: BASE_URL,
        configured,
        error: String(e),
        install_hint:
          "Clone https://github.com/KaiyzerCal/daily_stock_analysis, run `pip install -r requirements.txt && uvicorn main:app --port 8000`, then set STOCK_ANALYSIS_URL in Supabase secrets for cloud access.",
      });
    }
  }

  if (!Deno.env.get("STOCK_ANALYSIS_URL")) {
    // Allow health above; block real actions when nothing is running
    try {
      await proxyGet("/", 3000);
    } catch {
      return err(
        "Stock Analysis server not reachable. Start it locally with `uvicorn main:app --port 8000` or set STOCK_ANALYSIS_URL to a hosted instance.",
        503
      );
    }
  }

  try {
    switch (action) {
      // ── Analysis ───────────────────────────────────────────────────────────
      case "analyze": {
        // params: { stocks: string[], market?: string, async?: boolean }
        const stocks = params.stocks as string[] | undefined;
        if (!stocks?.length) return err("stocks[] required", 400);
        const data = await proxyPost("/api/v1/analysis/analyze", {
          stocks,
          market: params.market ?? "auto",
          async: params.async ?? false,
        }, 180000);
        return ok(data);
      }

      case "market_review": {
        // params: { market?: string }
        const data = await proxyPost("/api/v1/analysis/market-review", {
          market: params.market ?? "all",
        }, 120000);
        return ok(data);
      }

      case "tasks": {
        const data = await proxyGet("/api/v1/analysis/tasks");
        return ok(data);
      }

      case "task_status": {
        const taskId = String(params.task_id ?? "");
        if (!taskId) return err("task_id required", 400);
        const data = await proxyGet(`/api/v1/analysis/status/${encodeURIComponent(taskId)}`);
        return ok(data);
      }

      // ── Stocks ─────────────────────────────────────────────────────────────
      case "quote": {
        const code = String(params.code ?? "");
        if (!code) return err("code required", 400);
        const data = await proxyGet(`/api/v1/stocks/${encodeURIComponent(code)}/quote`);
        return ok(data);
      }

      case "history": {
        const code = String(params.code ?? "");
        if (!code) return err("code required", 400);
        const period = String(params.period ?? "1mo");
        const data = await proxyGet(`/api/v1/stocks/${encodeURIComponent(code)}/history?period=${period}`);
        return ok(data);
      }

      case "watchlist": {
        const data = await proxyGet("/api/v1/stocks/watchlist");
        return ok(data);
      }

      case "watchlist_add": {
        const code = String(params.code ?? "");
        if (!code) return err("code required", 400);
        const data = await proxyPost("/api/v1/stocks/watchlist/add", { code });
        return ok(data);
      }

      case "watchlist_remove": {
        const code = String(params.code ?? "");
        if (!code) return err("code required", 400);
        const data = await proxyPost("/api/v1/stocks/watchlist/remove", { code });
        return ok(data);
      }

      // ── Portfolio ──────────────────────────────────────────────────────────
      case "portfolio": {
        const data = await proxyGet("/api/v1/portfolio");
        return ok(data);
      }

      // ── Alerts ────────────────────────────────────────────────────────────
      case "alerts": {
        const data = await proxyGet("/api/v1/alerts");
        return ok(data);
      }

      // ── Decision signals ───────────────────────────────────────────────────
      case "decision_signals": {
        const market = params.market ? `?market=${encodeURIComponent(String(params.market))}` : "";
        const data = await proxyGet(`/api/v1/decision-signals${market}`);
        return ok(data);
      }

      // ── Market intelligence ────────────────────────────────────────────────
      case "intelligence": {
        const data = await proxyGet("/api/v1/intelligence");
        return ok(data);
      }

      // ── Agent chat ─────────────────────────────────────────────────────────
      case "agent_chat": {
        const message = String(params.message ?? "");
        if (!message) return err("message required", 400);
        const data = await proxyPost("/api/v1/agent", {
          message,
          strategy: params.strategy ?? "fundamental",
          session_id: params.session_id,
        }, 120000);
        return ok(data);
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(msg);
  }
});
