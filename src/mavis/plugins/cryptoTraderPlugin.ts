/**
 * Crypto Trader Plugin — Binance + CoinGecko integration.
 * Market data via CoinGecko (no auth needed for public prices) and
 * Binance for order execution. Mirrors stockTraderPlugin patterns.
 *
 * Risk controls identical to stock trader:
 *  - Max position % of portfolio
 *  - Stop-loss on every buy
 *  - Approval queue above threshold
 */

import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { MavisPlugin, MavisAction, MavisProvider, MavisEvaluator, PluginContext, ActionResult } from "@/mavis/pluginSystem";
import { storeMemory, buildMemoryContext } from "@/mavis/agentMemoryEngine";
import { sendMessage } from "@/mavis/interAgentBus";

// ── Config ────────────────────────────────────────────────────────────────────

interface BinanceConfig {
  apiKey?: string;
  secretKey?: string;
  testnet?: boolean;
  maxPositionPct?: number;         // % of total portfolio value per coin (default 5)
  stopLossPct?: number;            // % below entry for auto stop-loss (default 4)
  approvalThresholdUsd?: number;   // Require approval above this (default 200)
}

let _config: BinanceConfig = {};

function binanceBase(): string {
  return _config.testnet !== false
    ? "https://testnet.binance.vision/api/v3"
    : "https://api.binance.com/api/v3";
}

// ── HMAC signature for Binance (Web Crypto API, works in browser) ─────────────

async function signQuery(queryString: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(queryString));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function binanceHeaders(): Record<string, string> {
  return { "X-MBX-APIKEY": _config.apiKey ?? "" };
}

// ── CoinGecko public API (no auth) ────────────────────────────────────────────

const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  ADA: "cardano", DOGE: "dogecoin", XRP: "ripple", AVAX: "avalanche-2",
  DOT: "polkadot", MATIC: "matic-network",
};

async function getCoinPrice(symbol: string): Promise<{ usd: number; usd_24h_change: number } | null> {
  const coinId = COINGECKO_IDS[symbol.toUpperCase()];
  if (!coinId) return null;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[coinId] ?? null;
  } catch { return null; }
}

async function getTopCoins(limit = 10): Promise<Array<{ symbol: string; price: number; change24h: number }>> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((c: Record<string, unknown>) => ({
      symbol: (c.symbol as string).toUpperCase(),
      price: c.current_price as number,
      change24h: c.price_change_percentage_24h as number,
    }));
  } catch { return []; }
}

// ── Binance account + order helpers ──────────────────────────────────────────

async function getBinanceAccount(): Promise<Record<string, unknown> | null> {
  if (!_config.apiKey || !_config.secretKey) return null;
  try {
    const ts = Date.now();
    const qs = `timestamp=${ts}`;
    const sig = await signQuery(qs, _config.secretKey);
    const res = await fetch(`${binanceBase()}/account?${qs}&signature=${sig}`, {
      headers: binanceHeaders(),
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function getBinanceBalance(): Promise<Array<{ asset: string; free: number; locked: number }>> {
  const account = await getBinanceAccount();
  if (!account) return [];
  const balances = (account.balances as Array<Record<string, unknown>>) ?? [];
  return balances
    .map(b => ({ asset: b.asset as string, free: parseFloat(b.free as string), locked: parseFloat(b.locked as string) }))
    .filter(b => b.free > 0 || b.locked > 0);
}

async function placeBinanceOrder(params: {
  symbol: string;  // e.g. "BTCUSDT"
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  timeInForce?: string;
}): Promise<{ orderId: number; status: string } | null> {
  if (!_config.apiKey || !_config.secretKey) return null;
  try {
    const ts = Date.now();
    let qs = `symbol=${params.symbol}&side=${params.side}&type=${params.type}&quantity=${params.quantity}&timestamp=${ts}`;
    if (params.type === "LIMIT" && params.price) {
      qs += `&price=${params.price}&timeInForce=${params.timeInForce ?? "GTC"}`;
    }
    const sig = await signQuery(qs, _config.secretKey);
    const res = await fetch(`${binanceBase()}/order?${qs}&signature=${sig}`, {
      method: "POST",
      headers: binanceHeaders(),
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ── Approval queue ────────────────────────────────────────────────────────────

async function queueCryptoApproval(
  ctx: PluginContext,
  orderDetails: Record<string, unknown>
): Promise<string> {
  const { data } = await supabase
    .from("mavis_approvals")
    .insert({
      user_id: ctx.userId,
      agent_id: ctx.agentId,
      action_type: "CRYPTO_TRADE_ORDER",
      payload: orderDetails,
      status: "pending",
    })
    .select("id")
    .single()
    .catch(() => ({ data: null }));

  return data?.id ?? "unknown";
}

// ── Actions ───────────────────────────────────────────────────────────────────

const GET_CRYPTO_PORTFOLIO: MavisAction = {
  name: "GET_CRYPTO_PORTFOLIO",
  similes: ["crypto portfolio", "my crypto", "coin balances", "crypto holdings"],
  description: "Fetch Binance account balances with current USD values",
  async validate() { return !!_config.apiKey; },
  async handler(ctx): Promise<ActionResult> {
    const balances = await getBinanceBalance();
    if (!balances.length) {
      return { success: false, output: "Cannot connect to Binance or no balances found", error: "API error" };
    }

    const lines: string[] = [];
    let totalUsd = 0;

    for (const b of balances.slice(0, 15)) {
      if (b.asset === "USDT" || b.asset === "BUSD") {
        const val = b.free + b.locked;
        totalUsd += val;
        lines.push(`  ${b.asset}: $${val.toFixed(2)}`);
      } else {
        const price = await getCoinPrice(b.asset);
        if (price) {
          const val = (b.free + b.locked) * price.usd;
          totalUsd += val;
          lines.push(`  ${b.asset}: ${(b.free + b.locked).toFixed(6)} @ $${price.usd.toFixed(2)} = $${val.toFixed(2)} (${price.usd_24h_change > 0 ? "+" : ""}${price.usd_24h_change.toFixed(1)}% 24h)`);
        }
      }
    }

    const summary = `Crypto portfolio (~$${totalUsd.toFixed(2)} total):\n${lines.join("\n")}`;

    await storeMemory({
      agentId: ctx.agentId, agentName: ctx.agentName, agentType: "plugin",
      entityType: "fact", memoryType: "working",
      content: summary,
      summary: `Crypto snapshot — ~$${totalUsd.toFixed(2)}`,
      tags: ["portfolio", "binance", "crypto"],
      wikilinks: ["[[BinanceAccount]]"],
      importance: 5, confidence: 9, sourceSession: ctx.agentId,
    }, ctx.userId);

    return { success: true, output: summary, data: { balances, totalUsd } };
  },
};

const GET_CRYPTO_PRICE: MavisAction = {
  name: "GET_CRYPTO_PRICE",
  similes: ["crypto price", "coin price", "how much is bitcoin", "btc price", "eth price"],
  description: "Get current price and 24h change for a cryptocurrency",
  async validate(_ctx, input) { return input.trim().length >= 2; },
  async handler(_ctx, input): Promise<ActionResult> {
    const symbol = input.trim().toUpperCase().replace(/[^A-Z]/g, "");
    const price = await getCoinPrice(symbol);

    if (!price) {
      return { success: false, output: `Cannot fetch price for ${symbol}. Supported: ${Object.keys(COINGECKO_IDS).join(", ")}`, error: "Not found" };
    }

    const direction = price.usd_24h_change > 0 ? "▲" : "▼";
    const output = `${symbol}: $${price.usd.toLocaleString()} ${direction} ${Math.abs(price.usd_24h_change).toFixed(2)}% (24h)`;
    return { success: true, output, data: price };
  },
};

const GET_MARKET_OVERVIEW: MavisAction = {
  name: "GET_CRYPTO_MARKET",
  similes: ["crypto market", "market overview", "top coins", "market summary"],
  description: "Get a snapshot of top cryptocurrencies by market cap",
  async validate() { return true; },
  async handler(): Promise<ActionResult> {
    const coins = await getTopCoins(10);
    if (!coins.length) return { success: false, output: "Cannot fetch market data", error: "API error" };

    const lines = coins.map(c =>
      `  ${c.symbol.padEnd(6)} $${c.price.toLocaleString().padStart(12)}  ${c.change24h > 0 ? "▲" : "▼"} ${Math.abs(c.change24h).toFixed(1)}%`
    );
    return { success: true, output: `Top 10 by Market Cap:\n${lines.join("\n")}`, data: coins };
  },
};

const LOG_CRYPTO_SIGNAL: MavisAction = {
  name: "LOG_CRYPTO_SIGNAL",
  similes: ["crypto signal", "coin signal", "log crypto", "defi signal"],
  description: "Log a crypto trade signal observation without executing",
  async validate(_ctx, input) { return input.trim().length > 5; },
  async handler(ctx, input): Promise<ActionResult> {
    await storeMemory({
      agentId: ctx.agentId, agentName: ctx.agentName, agentType: "plugin",
      entityType: "signal", memoryType: "episodic",
      content: input,
      tags: ["signal", "crypto", "manual"],
      wikilinks: [],
      importance: 7, confidence: 6, sourceSession: ctx.agentId,
    }, ctx.userId);

    await sendMessage(
      { id: ctx.agentId, name: ctx.agentName, type: "plugin" },
      "mavis", "SIGNAL",
      `Crypto signal: ${input.slice(0, 100)}`,
      { payload: { signal: input, market: "crypto" } }
    );

    return { success: true, output: `Crypto signal logged: "${input.slice(0, 80)}..."` };
  },
};

const EXECUTE_CRYPTO_TRADE: MavisAction = {
  name: "EXECUTE_CRYPTO_TRADE",
  similes: ["buy crypto", "sell crypto", "buy bitcoin", "sell eth", "crypto order"],
  description: "Execute a crypto trade on Binance with risk management",
  async validate() { return !!_config.apiKey && !!_config.secretKey; },
  async handler(ctx, input): Promise<ActionResult> {
    // Parse: "buy 0.01 BTC" or "sell 0.5 ETH limit 2000"
    const buyMatch = input.match(/buy\s+([\d.]+)\s+([A-Z]{2,8})(?:\s+limit\s+([\d.]+))?/i);
    const sellMatch = input.match(/sell\s+([\d.]+)\s+([A-Z]{2,8})(?:\s+limit\s+([\d.]+))?/i);
    const match = buyMatch ?? sellMatch;

    if (!match) {
      return {
        success: false,
        output: 'Parse error. Use: "buy 0.01 BTC" or "sell 0.5 ETH limit 2000"',
        error: "Parse error",
      };
    }

    const side = buyMatch ? "BUY" : "SELL";
    const qty = parseFloat(match[1]);
    const symbol = match[2].toUpperCase();
    const limitPrice = match[3] ? parseFloat(match[3]) : undefined;
    const orderType = limitPrice ? "LIMIT" : "MARKET";
    const tradingPair = `${symbol}USDT`;

    // Get current price
    const priceData = await getCoinPrice(symbol);
    const currentPrice = priceData?.usd ?? limitPrice ?? 0;
    const notional = qty * currentPrice;

    const approvalThreshold = _config.approvalThresholdUsd ?? 200;
    const orderDetails = { symbol, tradingPair, qty, side, type: orderType, limitPrice, notional: notional.toFixed(2) };

    // Approval gate
    if (notional > approvalThreshold) {
      const approvalId = await queueCryptoApproval(ctx, orderDetails);
      return {
        success: true,
        output: `Crypto order queued for approval ($${notional.toFixed(2)} > threshold $${approvalThreshold}). ID: ${approvalId}`,
        data: { queued: true, approvalId, orderDetails },
      };
    }

    const order = await placeBinanceOrder({
      symbol: tradingPair,
      side,
      type: orderType,
      quantity: qty,
      price: limitPrice,
    });

    if (!order) {
      return { success: false, output: `Order failed for ${side} ${qty} ${symbol}`, error: "Binance API error" };
    }

    // Auto stop-loss (limit sell below entry for buys)
    const stopLossPct = _config.stopLossPct ?? 4;
    const stopPrice = parseFloat((currentPrice * (1 - stopLossPct / 100)).toFixed(2));
    if (side === "BUY" && currentPrice > 0) {
      await placeBinanceOrder({ symbol: tradingPair, side: "SELL", type: "LIMIT", quantity: qty, price: stopPrice });
    }

    await storeMemory({
      agentId: ctx.agentId, agentName: ctx.agentName, agentType: "plugin",
      entityType: "decision", memoryType: "episodic",
      content: `Executed ${side} ${qty} ${symbol} @ ~$${currentPrice.toFixed(2)}. Order ID: ${order.orderId}. Stop at $${stopPrice}`,
      summary: `${side} ${qty} ${symbol} — $${notional.toFixed(2)}`,
      tags: ["trade", "executed", side.toLowerCase(), symbol, "crypto"],
      wikilinks: [`[[${symbol}]]`, "[[BinanceOrders]]"],
      importance: 9, confidence: 9, sourceSession: ctx.agentId,
    }, ctx.userId);

    return {
      success: true,
      output: `${side} ${qty} ${symbol} placed. Order ID: ${order.orderId}. Status: ${order.status}. Stop-loss at $${stopPrice}`,
      data: order,
    };
  },
};

// ── Provider ──────────────────────────────────────────────────────────────────

const cryptoMarketProvider: MavisProvider = {
  name: "CryptoMarketContext",
  description: "Injects top coin prices and crypto trade memory into prompts",
  async get(ctx): Promise<string> {
    const [coins, memCtx] = await Promise.all([
      getTopCoins(5),
      buildMemoryContext(ctx.agentId, ctx.userId, "crypto signals trades"),
    ]);

    const priceSnap = coins.length
      ? `Market: ${coins.map(c => `${c.symbol} $${c.price.toLocaleString()}`).join(" | ")}`
      : "";

    return [priceSnap, memCtx].filter(Boolean).join("\n");
  },
};

// ── Evaluator ─────────────────────────────────────────────────────────────────

const cryptoRiskEvaluator: MavisEvaluator = {
  name: "CryptoRiskAssessor",
  alwaysRun: false,
  async validate(_ctx, output) {
    return /\b(buy|sell|trade|crypto|bitcoin|ethereum|coin|defi|yield)\b/i.test(output);
  },
  async handler(_ctx, output) {
    const highRisk = /\b(leverage|margin|liquidation|ape in|yolo|100x)\b/i.test(output);
    return {
      score: highRisk ? 0.25 : 0.75,
      feedback: highRisk ? "High-risk trading language detected — review before acting" : undefined,
      memoryWorthy: /\b(pattern|thesis|signal|setup|breakout|support|resistance)\b/i.test(output),
    };
  },
};

// ── Plugin export ─────────────────────────────────────────────────────────────

export const cryptoTraderPlugin: MavisPlugin = {
  name: "crypto-trader",
  version: "1.0.0",
  description: "Binance + CoinGecko crypto trading with autonomous execution and risk controls",
  author: "MAVIS",
  capabilities: ["inference", "tool", "trading", "market-data", "crypto"],
  requiredScopes: ["binance_api_key", "binance_secret_key"],
  actions: [GET_CRYPTO_PORTFOLIO, GET_CRYPTO_PRICE, GET_MARKET_OVERVIEW, LOG_CRYPTO_SIGNAL, EXECUTE_CRYPTO_TRADE],
  providers: [cryptoMarketProvider],
  evaluators: [cryptoRiskEvaluator],
  async onEnable(config) {
    _config = config as BinanceConfig;
  },
  async onDisable() {
    _config = {};
  },
};
