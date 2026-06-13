// MAVIS Finance — Era.app MCP Bridge + REST API
// Personal finance integration: bank accounts, transactions, goals, net worth, budgets.
// Tries local Era.app MCP server first, falls back to Era REST API.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ERA_MCP_URL = Deno.env.get("ERA_MCP_URL") ?? "http://localhost:8765";
const ERA_API_KEY = Deno.env.get("ERA_API_KEY") ?? "";
const ERA_API_URL = Deno.env.get("ERA_API_URL") ?? "https://api.era.app/v1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAVIS_CHAT_URL = `${SUPABASE_URL}/functions/v1/mavis-chat`;

// ─────────────────────────────────────────────────────────────
// Era.app MCP call (local desktop app)
// ─────────────────────────────────────────────────────────────

async function eraMcpCall(method: string, params: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`${ERA_MCP_URL}/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "tools/call",
      params: { name: method, arguments: params },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Era MCP ${res.status}`);
  const j = await res.json();
  return j.result?.content?.[0]?.text ?? null;
}

// ─────────────────────────────────────────────────────────────
// Era.app REST API (cloud fallback)
// ─────────────────────────────────────────────────────────────

async function eraApiCall(path: string, params?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${ERA_API_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${ERA_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Era API ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────
// MCP-first with REST fallback wrapper
// ─────────────────────────────────────────────────────────────

async function eraCall(
  mcpMethod: string,
  mcpParams: Record<string, unknown>,
  restPath: string,
  restParams?: Record<string, unknown>,
): Promise<unknown> {
  // Try local MCP first
  try {
    const text = await eraMcpCall(mcpMethod, mcpParams);
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }
  } catch {
    // MCP not available — fall through to REST API
  }

  // Try REST API
  if (!ERA_API_KEY) {
    return null; // neither available
  }
  return eraApiCall(restPath, restParams);
}

// ─────────────────────────────────────────────────────────────
// Action handlers
// ─────────────────────────────────────────────────────────────

async function getAccounts(userId: string): Promise<unknown> {
  return eraCall(
    "era_get_accounts",
    { user_id: userId },
    "/accounts",
    { user_id: userId },
  );
}

async function getTransactions(
  userId: string,
  dateRange?: { start: string; end: string },
  accountId?: string,
): Promise<unknown> {
  const params: Record<string, unknown> = { user_id: userId };
  if (dateRange?.start) params.start_date = dateRange.start;
  if (dateRange?.end) params.end_date = dateRange.end;
  if (accountId) params.account_id = accountId;

  return eraCall(
    "era_get_transactions",
    params,
    "/transactions",
    params,
  );
}

async function getGoals(userId: string): Promise<unknown> {
  return eraCall(
    "era_get_goals",
    { user_id: userId },
    "/goals",
    { user_id: userId },
  );
}

async function getNetWorth(userId: string): Promise<unknown> {
  return eraCall(
    "era_get_net_worth",
    { user_id: userId },
    "/net-worth",
    { user_id: userId },
  );
}

async function getBudget(userId: string): Promise<unknown> {
  return eraCall(
    "era_get_budget",
    { user_id: userId },
    "/budget",
    { user_id: userId },
  );
}

async function analyzeSpending(
  userId: string,
  query: string,
  serviceKey: string,
): Promise<unknown> {
  // Fetch transactions first, then pass to MAVIS for Socratic analysis
  let transactions: unknown = null;
  try {
    transactions = await getTransactions(userId, undefined, undefined);
  } catch {
    transactions = null;
  }

  const summary = transactions
    ? `Transaction data: ${JSON.stringify(transactions).slice(0, 3000)}`
    : "No transaction data available.";

  const analysisPrompt = `${query}\n\n${summary}`;

  const chatRes = await fetch(MAVIS_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      message: analysisPrompt,
      user_id: userId,
      mode: "PRIME",
      system_override:
        "You are MAVIS analyzing personal finance data. Provide clear, actionable insights about spending patterns, savings opportunities, and financial health. Be concise and specific.",
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!chatRes.ok) {
    return { analysis: "Unable to generate analysis at this time.", raw_data: transactions };
  }

  const chatData = await chatRes.json();
  return {
    analysis: chatData.response ?? chatData.message ?? "Analysis complete.",
    transaction_summary: transactions,
  };
}

// ─────────────────────────────────────────────────────────────
// Cache helper — store results in era_financial_cache
// ─────────────────────────────────────────────────────────────

async function cacheResult(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  cacheType: string,
  data: unknown,
  periodStart?: string,
  periodEnd?: string,
): Promise<void> {
  try {
    await supabase.from("era_financial_cache").upsert(
      {
        user_id: userId,
        cache_type: cacheType,
        data: data,
        period_start: periodStart ?? null,
        period_end: periodEnd ?? null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,cache_type,period_start" },
    );
  } catch {
    // Cache write failures are non-fatal
  }
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      action,
      user_id,
      date_range,
      account_id,
      query,
    }: {
      action: string;
      user_id: string;
      date_range?: { start: string; end: string };
      account_id?: string;
      query?: string;
    } = body;

    if (!action || !user_id) {
      return new Response(
        JSON.stringify({ error: "action and user_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Check if Era is reachable at all
    const eraAvailable = ERA_API_KEY !== "" || ERA_MCP_URL !== "";

    if (!eraAvailable) {
      return new Response(
        JSON.stringify({
          status: "not_connected",
          message:
            "Era.app not connected. Install Era.app desktop and enable MCP, or configure ERA_API_KEY.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let result: unknown;
    let notConnected = false;

    switch (action) {
      case "get_accounts": {
        result = await getAccounts(user_id);
        if (result !== null) await cacheResult(supabase, user_id, "accounts", result);
        break;
      }
      case "get_transactions": {
        result = await getTransactions(user_id, date_range, account_id);
        if (result !== null) {
          await cacheResult(
            supabase,
            user_id,
            "transactions",
            result,
            date_range?.start,
            date_range?.end,
          );
        }
        break;
      }
      case "get_goals": {
        result = await getGoals(user_id);
        if (result !== null) await cacheResult(supabase, user_id, "goals", result);
        break;
      }
      case "get_net_worth": {
        result = await getNetWorth(user_id);
        if (result !== null) await cacheResult(supabase, user_id, "net_worth", result);
        break;
      }
      case "get_budget": {
        result = await getBudget(user_id);
        if (result !== null) await cacheResult(supabase, user_id, "budget", result);
        break;
      }
      case "analyze": {
        result = await analyzeSpending(user_id, query ?? "Analyze my spending patterns.", SUPABASE_SERVICE_KEY);
        break;
      }
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    if (result === null) {
      notConnected = true;
    }

    if (notConnected) {
      return new Response(
        JSON.stringify({
          status: "not_connected",
          message:
            "Era.app not connected. Install Era.app desktop and enable MCP, or configure ERA_API_KEY.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", action, data: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-finance]", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
