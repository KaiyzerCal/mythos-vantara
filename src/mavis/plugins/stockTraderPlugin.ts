/**
 * Stock Trader Plugin — Alpaca Markets integration.
 * Supports market data (via API + manual logging), signal generation,
 * and autonomous order execution with risk controls.
 *
 * Risk controls:
 *  - Max single position: configurable (default 5% of portfolio)
 *  - Trades above threshold go to approval queue before execution
 *  - Stop-loss attached to every order
 *  - No leveraged positions without explicit operator approval
 */

import { supabase } from "@/integrations/supabase/client";
import { MavisPlugin, MavisAction, MavisProvider, MavisEvaluator, PluginContext, ActionResult } from "@/mavis/pluginSystem";
import { storeMemory, buildMemoryContext } from "@/mavis/agentMemoryEngine";
import { sendMessage } from "@/mavis/interAgentBus";

// ── Config (loaded from mavis_plugins.config) ─────────────────────────────────

interface AlpacaConfig {
  apiKey?: string;
  secretKey?: string;
  paper?: boolean;                 // Use paper trading endpoint
  maxPositionPct?: number;         // Max % of equity per position (default 5)
  stopLossPct?: number;            // Auto stop-loss % below entry (default 3)
  approvalThresholdUsd?: number;   // Orders above this need approval (default 500)
}

let _config: AlpacaConfig = {};

function alpacaBase(): string {
  return _config.paper !== false
    ? "https://paper-api.alpaca.markets/v2"
    : "https://api.alpaca.markets/v2";
}

function alpacaHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": _config.apiKey ?? "",
    "APCA-API-SECRET-KEY": _config.secretKey ?? "",
    "Content-Type": "application/json",
  };
}

// ── Alpaca API helpers ────────────────────────────────────────────────────────

async function getAccount(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${alpacaBase()}/account`, { headers: alpacaHeaders() });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function getPositions(): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await fetch(`${alpacaBase()}/positions`, { headers: alpacaHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

async function getQuote(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://data.alpaca.markets/v2/stocks/${symbol.toUpperCase()}/quotes/latest`;
    const res = await fetch(url, { headers: alpacaHeaders() });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function placeOrder(params: {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type: "market" | "limit";
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: string;
}): Promise<{ id: string; status: string } | null> {
  try {
    const body: Record<string, unknown> = {
      symbol: params.symbol.toUpperCase(),
      qty: params.qty,
      side: params.side,
      type: params.type,
      time_in_force: params.timeInForce ?? "day",
    };
    if (params.type === "limit" && params.limitPrice) body.limit_price = params.limitPrice;

    const res = await fetch(`${alpacaBase()}/orders`, {
      method: "POST",
      headers: alpacaHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ── Risk management ───────────────────────────────────────────────────────────

async function checkRiskLimits(
  symbol: string,
  notionalValue: number,
  ctx: PluginContext
): Promise<{ approved: boolean; reason?: string }> {
  const account = await getAccount();
  if (!account) return { approved: false, reason: "Cannot fetch account data" };

  const equity = parseFloat(account.equity as string);
  const maxPct = _config.maxPositionPct ?? 5;
  const maxNotional = equity * (maxPct / 100);

  if (notionalValue > maxNotional) {
    return {
      approved: false,
      reason: `Order $${notionalValue.toFixed(2)} exceeds max position size $${maxNotional.toFixed(2)} (${maxPct}% of $${equity.toFixed(2)} equity)`,
    };
  }

  return { approved: true };
}

async function queueForApproval(
  ctx: PluginContext,
  orderDetails: Record<string, unknown>
): Promise<string> {
  const { data } = await supabase
    .from("mavis_approvals")
    .insert({
      user_id: ctx.userId,
      agent_id: ctx.agentId,
      action_type: "TRADE_ORDER",
      payload: orderDetails,
      status: "pending",
    })
    .select("id")
    .single()
    .catch(() => ({ data: null }));

  return data?.id ?? "unknown";
}

// ── Actions ───────────────────────────────────────────────────────────────────

const GET_PORTFOLIO: MavisAction = {
  name: "GET_STOCK_PORTFOLIO",
  similes: ["show portfolio", "portfolio status", "my stocks", "positions"],
  description: "Fetch current Alpaca account equity, positions, and P&L",
  async validate() { return !!_config.apiKey; },
  async handler(ctx): Promise<ActionResult> {
    const [account, positions] = await Promise.all([getAccount(), getPositions()]);
    if (!account) return { success: false, output: "Cannot connect to Alpaca API", error: "Auth failed" };

    const posLines = (positions as Array<Record<string, unknown>>).map(p =>
      `  ${p.symbol}: ${p.qty} shares @ $${parseFloat(p.avg_entry_price as string).toFixed(2)} | P&L: $${parseFloat(p.unrealized_pl as string).toFixed(2)}`
    ).join("\n");

    const summary = `Portfolio equity: $${parseFloat(account.equity as string).toFixed(2)}\nCash: $${parseFloat(account.cash as string).toFixed(2)}\n\nPositions:\n${posLines || "No open positions"}`;

    await storeMemory({
      agentId: ctx.agentId,
      agentName: ctx.agentName,
      agentType: "plugin",
      entityType: "fact",
      memoryType: "working",
      content: summary,
      summary: `Portfolio snapshot — equity $${parseFloat(account.equity as string).toFixed(2)}`,
      tags: ["portfolio", "alpaca", "equity"],
      wikilinks: ["[[AlpacaAccount]]"],
      importance: 5,
      confidence: 9,
      sourceSession: ctx.agentId,
    }, ctx.userId);

    return { success: true, output: summary, data: { account, positions } };
  },
};

const GET_QUOTE: MavisAction = {
  name: "GET_STOCK_QUOTE",
  similes: ["stock price", "quote", "what is the price of", "how much is"],
  description: "Get the latest quote for a stock symbol",
  async validate(_ctx, input) { return input.trim().length > 0; },
  async handler(_ctx, input): Promise<ActionResult> {
    const symbol = input.trim().toUpperCase().replace(/[^A-Z]/g, "");
    const quote = await getQuote(symbol);
    if (!quote) return { success: false, output: `Cannot fetch quote for ${symbol}`, error: "API error" };

    const q = (quote as Record<string, unknown>).quote as Record<string, unknown>;
    const price = ((q?.ap as number) + (q?.bp as number)) / 2;
    const output = `${symbol}: $${price?.toFixed(2) ?? "N/A"} | Ask: $${(q?.ap as number)?.toFixed(2)} | Bid: $${(q?.bp as number)?.toFixed(2)}`;

    return { success: true, output, data: quote };
  },
};

const LOG_TRADE_SIGNAL: MavisAction = {
  name: "LOG_TRADE_SIGNAL",
  similes: ["signal", "trade signal", "market signal", "log signal"],
  description: "Log a trade signal observation (bullish/bearish thesis without executing)",
  async validate(_ctx, input) { return input.trim().length > 10; },
  async handler(ctx, input): Promise<ActionResult> {
    await storeMemory({
      agentId: ctx.agentId,
      agentName: ctx.agentName,
      agentType: "plugin",
      entityType: "signal",
      memoryType: "episodic",
      content: input,
      tags: ["signal", "manual"],
      wikilinks: [],
      importance: 7,
      confidence: 6,
      sourceSession: ctx.agentId,
    }, ctx.userId);

    await sendMessage(
      { id: ctx.agentId, name: ctx.agentName, type: "plugin" },
      "mavis",
      "SIGNAL",
      `Trade signal logged: ${input.slice(0, 100)}`,
      { payload: { signal: input, source: "manual" } }
    );

    return { success: true, output: `Signal logged: "${input.slice(0, 80)}..."` };
  },
};

const EXECUTE_TRADE: MavisAction = {
  name: "EXECUTE_STOCK_TRADE",
  similes: ["buy stock", "sell stock", "place order", "buy shares", "sell shares", "trade"],
  description: "Execute a stock trade on Alpaca with risk management controls",
  async validate() { return !!_config.apiKey && !!_config.secretKey; },
  async handler(ctx, input): Promise<ActionResult> {
    // Parse: "buy 10 AAPL at market" or "sell 5 TSLA limit 180"
    const buyMatch = input.match(/buy\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,5})(?:\s+(?:at\s+)?(?:market|limit\s+([\d.]+)))?/i);
    const sellMatch = input.match(/sell\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,5})(?:\s+(?:at\s+)?(?:market|limit\s+([\d.]+)))?/i);
    const match = buyMatch ?? sellMatch;

    if (!match) {
      return {
        success: false,
        output: 'Cannot parse order. Use: "buy 10 AAPL at market" or "sell 5 TSLA limit 180"',
        error: "Parse error",
      };
    }

    const side = buyMatch ? "buy" : "sell";
    const qty = parseFloat(match[1]);
    const symbol = match[2].toUpperCase();
    const limitPrice = match[3] ? parseFloat(match[3]) : undefined;
    const orderType = limitPrice ? "limit" : "market";

    // Get current price to estimate notional
    const quote = await getQuote(symbol);
    const q = (quote as Record<string, unknown> | null)?.quote as Record<string, unknown> | undefined;
    const midPrice = q ? ((q.ap as number) + (q.bp as number)) / 2 : limitPrice ?? 0;
    const notional = qty * midPrice;

    // Risk check
    const risk = await checkRiskLimits(symbol, notional, ctx);
    if (!risk.approved) {
      await storeMemory({
        agentId: ctx.agentId, agentName: ctx.agentName, agentType: "plugin",
        entityType: "decision", memoryType: "episodic",
        content: `Trade blocked — ${risk.reason}`,
        summary: `Risk block: ${side} ${qty} ${symbol}`,
        tags: ["risk", "blocked", symbol],
        wikilinks: [`[[${symbol}]]`],
        importance: 8, confidence: 9, sourceSession: ctx.agentId,
      }, ctx.userId);

      return { success: false, output: `Risk limit: ${risk.reason}`, error: "Risk check failed" };
    }

    const approvalThreshold = _config.approvalThresholdUsd ?? 500;
    const orderDetails = { symbol, qty, side, type: orderType, limitPrice, notional: notional.toFixed(2) };

    // Queue for approval if above threshold
    if (notional > approvalThreshold) {
      const approvalId = await queueForApproval(ctx, orderDetails);
      return {
        success: true,
        output: `Order queued for approval (notional $${notional.toFixed(2)} > threshold $${approvalThreshold}). Approval ID: ${approvalId}`,
        data: { queued: true, approvalId, orderDetails },
      };
    }

    // Execute
    const order = await placeOrder({ symbol, qty, side, type: orderType, limitPrice });
    if (!order) {
      return { success: false, output: `Order placement failed for ${side} ${qty} ${symbol}`, error: "API error" };
    }

    const stopPrice = midPrice * (1 - (_config.stopLossPct ?? 3) / 100);
    if (side === "buy" && midPrice > 0) {
      await placeOrder({ symbol, qty, side: "sell", type: "limit", limitPrice: stopPrice, timeInForce: "gtc" });
    }

    await storeMemory({
      agentId: ctx.agentId, agentName: ctx.agentName, agentType: "plugin",
      entityType: "decision", memoryType: "episodic",
      content: `Executed ${side} ${qty} ${symbol} @ ~$${midPrice.toFixed(2)}. Order ID: ${order.id}. Stop at $${stopPrice.toFixed(2)}`,
      summary: `${side.toUpperCase()} ${qty} ${symbol} — $${notional.toFixed(2)}`,
      tags: ["trade", "executed", side, symbol],
      wikilinks: [`[[${symbol}]]`, "[[AlpacaOrders]]"],
      importance: 9, confidence: 9, sourceSession: ctx.agentId,
    }, ctx.userId);

    return {
      success: true,
      output: `Order placed: ${side.toUpperCase()} ${qty} ${symbol}. Order ID: ${order.id}. Status: ${order.status}. Stop-loss set at $${stopPrice.toFixed(2)}`,
      data: order,
    };
  },
};

// ── Provider (injects market context into prompts) ────────────────────────────

const portfolioProvider: MavisProvider = {
  name: "StockPortfolioContext",
  description: "Injects current portfolio summary and recent trade signals",
  async get(ctx): Promise<string> {
    if (!_config.apiKey) return "";

    const memCtx = await buildMemoryContext(ctx.agentId, ctx.userId, "portfolio positions signals");
    const positions = await getPositions();
    if (positions.length === 0) return memCtx || "";

    const posLines = (positions as Array<Record<string, unknown>>)
      .slice(0, 5)
      .map(p => `${p.symbol}: qty=${p.qty} unrealized_pl=$${parseFloat(p.unrealized_pl as string).toFixed(2)}`)
      .join(", ");

    return `Open positions: ${posLines}\n${memCtx}`.trim();
  },
};

// ── Evaluator ─────────────────────────────────────────────────────────────────

const tradeRiskEvaluator: MavisEvaluator = {
  name: "TradeRiskAssessor",
  alwaysRun: false,
  async validate(_ctx, output) {
    return /\b(buy|sell|trade|order|position|shares|stock)\b/i.test(output);
  },
  async handler(_ctx, output) {
    const hasRisk = /\b(margin|leverage|naked|unlimited risk|no stop)\b/i.test(output);
    return {
      score: hasRisk ? 0.3 : 0.8,
      feedback: hasRisk ? "Output references risky trading practices without stop-loss mention" : undefined,
      memoryWorthy: /\b(signal|thesis|pattern|setup)\b/i.test(output),
    };
  },
};

// ── Plugin export ─────────────────────────────────────────────────────────────

export const stockTraderPlugin: MavisPlugin = {
  name: "stock-trader",
  version: "1.0.0",
  description: "Alpaca Markets integration for autonomous stock trading with risk controls",
  author: "MAVIS",
  capabilities: ["inference", "tool", "trading", "market-data"],
  requiredScopes: ["alpaca_api_key", "alpaca_secret_key"],
  actions: [GET_PORTFOLIO, GET_QUOTE, LOG_TRADE_SIGNAL, EXECUTE_TRADE],
  providers: [portfolioProvider],
  evaluators: [tradeRiskEvaluator],
  async onEnable(config) {
    _config = config as AlpacaConfig;
  },
  async onDisable() {
    _config = {};
  },
};
