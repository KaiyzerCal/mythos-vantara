// MAVIS Signal Watcher — proactive eyes on the world, runs every 15 min via pg_cron.
// Monitors configurable signals and initiates full reasoning sessions when something
// significant happens, delivering a complete briefing to Telegram.
//
// Signal types:
//   rss            — monitor RSS feed for new items since last trigger
//   market_move    — monitor crypto/stock price for threshold % change
//   keyword_email  — scan mavis_memory for email-tagged content matching keywords
//   keyword_telegram — scan mavis_memory for telegram-tagged content matching keywords
//
// Actions:
//   watch_signals        — cron entry point; iterates all active configs
//   get_signal_configs   — return all configs for a user
//   upsert_signal_config — insert or update a config
//   delete_signal_config — remove a config

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL       = Deno.env.get("SUPABASE_URL")!;
const SB_SRK       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Signal checkers ──────────────────────────────────────────────────────────

async function checkRssSignal(config: any): Promise<{ triggered: boolean; items: any[] }> {
  // Fetch RSS feed XML from config.source URL
  const res = await fetch(config.source, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return { triggered: false, items: [] };
  const xml = await res.text();
  // Parse RSS items — find pubDate, title, link, description
  // Simple XML parsing: extract <item> blocks
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  const items = [];
  const cutoff = config.last_triggered_at ? new Date(config.last_triggered_at) : new Date(Date.now() - 24 * 3600_000);
  for (const match of itemMatches) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1] || block.match(/<title>(.*?)<\/title>/)?.[1] || "";
    const pubDateStr = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
    const link = block.match(/<link>(.*?)<\/link>/)?.[1] || "";
    const description = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] || block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "").slice(0, 300);
    const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
    if (pubDate > cutoff) items.push({ title, link, description, pubDate: pubDate.toISOString() });
    if (items.length >= 5) break;
  }
  return { triggered: items.length > 0, items };
}

async function checkMarketSignal(config: any): Promise<{ triggered: boolean; data: any }> {
  // config.source = ticker symbol (e.g. "BTC", "AAPL", "ETH")
  // config.threshold = { price_change_pct: 5 }
  const threshold = (config.threshold as any)?.price_change_pct ?? 5;
  // Use CoinGecko for crypto, Yahoo Finance for stocks
  const ticker = String(config.source).toUpperCase();
  const cryptoIds: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin" };

  if (cryptoIds[ticker]) {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds[ticker]}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!res?.ok) return { triggered: false, data: null };
    const d = await res.json();
    const change = Math.abs(d[cryptoIds[ticker]]?.usd_24h_change ?? 0);
    const price = d[cryptoIds[ticker]]?.usd ?? 0;
    const triggered = change >= threshold;
    return { triggered, data: { ticker, price, change_24h: d[cryptoIds[ticker]]?.usd_24h_change, threshold } };
  }
  return { triggered: false, data: null };
}

async function checkKeywordSignal(sb: any, config: any, userId: string, signal_type: string): Promise<{ triggered: boolean; matches: string[] }> {
  // Check mavis_memory for recent messages tagged with email/telegram keywords
  // config.threshold = { keywords: ["urgent", "deadline", "invoice"] }
  const keywords: string[] = (config.threshold as any)?.keywords ?? [];
  if (!keywords.length) return { triggered: false, matches: [] };
  const cutoff = config.last_triggered_at ? new Date(config.last_triggered_at).getTime() : Date.now() - 4 * 3600_000;
  const source = signal_type === "keyword_email" ? "email" : "telegram";
  const { data: rows } = await sb.from("mavis_memory")
    .select("content, timestamp")
    .eq("user_id", userId)
    .contains("tags", [source])
    .gte("timestamp", cutoff)
    .limit(20);
  const matches: string[] = [];
  for (const row of rows ?? []) {
    const content = String(row.content).toLowerCase();
    for (const kw of keywords) {
      if (content.includes(kw.toLowerCase())) { matches.push(`${kw}: ${String(row.content).slice(0, 100)}`); break; }
    }
  }
  return { triggered: matches.length > 0, matches };
}

// ── Briefing generator + Telegram sender ─────────────────────────────────────

async function generateAndSendBriefing(sb: any, userId: string, signalType: string, signalName: string, signalData: unknown): Promise<void> {
  // Get operator context (world model + active plans)
  const [{ data: wm }, { data: plans }, { data: profile }] = await Promise.all([
    sb.from("mavis_world_model").select("summary, opportunities, risks").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("mavis_plans").select("title, goal, current_step, steps").eq("user_id", userId).eq("status", "active").limit(3),
    sb.from("profiles").select("telegram_chat_id, display_name").eq("id", userId).maybeSingle(),
  ]);

  const context = `Signal type: ${signalType}\nSignal name: ${signalName}\nSignal data: ${JSON.stringify(signalData).slice(0, 800)}\n\nOperator world model summary: ${(wm as any)?.summary?.slice(0, 400) ?? "N/A"}\n\nActive plans: ${(plans ?? []).map((p: any) => p.title).join(", ") || "None"}`;

  const briefing = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: "You are MAVIS, a sovereign personal AI agent. Generate a proactive intelligence briefing about a detected signal. Be direct, specific, and action-oriented. Format for Telegram HTML. 3-5 paragraphs max.",
      messages: [{ role: "user", content: `Generate a briefing for this signal:\n\n${context}` }],
    }),
    signal: AbortSignal.timeout(25_000),
  }).then(r => r.json()).then(d => d.content?.[0]?.text ?? "").catch(() => "");

  const chatId = (profile as any)?.telegram_chat_id;

  if (chatId && briefing) {
    const msg = `🚨 <b>MAVIS Proactive Alert</b>\n<i>${signalName}</i>\n\n${briefing}`;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4096), parse_mode: "HTML" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  if (briefing) {
    await sb.from("mavis_memory").insert({
      user_id: userId,
      content: `Proactive signal briefing [${signalName}]: ${briefing}`,
      importance_score: 4,
      tags: ["proactive", "signal", signalType],
      timestamp: Date.now(),
      consolidated: false,
    }).catch(() => {});
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { action, userId, ...p } = body as Record<string, unknown>;
    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
    let result: unknown;

    switch (action as string) {
      case "watch_signals": {
        // Get all users with active signal configs
        const { data: configs } = await sb.from("mavis_signal_configs")
          .select("*, user_id")
          .eq("is_active", true);

        const userIds = [...new Set((configs ?? []).map((c: any) => c.user_id as string))];
        const results: any[] = [];

        for (const uid of userIds) {
          const userConfigs = (configs ?? []).filter((c: any) => c.user_id === uid);
          let triggered = 0;

          for (const config of userConfigs) {
            // Check cooldown
            if (config.last_triggered_at) {
              const hoursSince = (Date.now() - new Date(config.last_triggered_at).getTime()) / 3600_000;
              if (hoursSince < (config.cooldown_hours ?? 4)) continue;
            }

            let signalResult: { triggered: boolean; data?: unknown; items?: unknown[]; matches?: string[] } = { triggered: false };

            try {
              if (config.signal_type === "rss") signalResult = await checkRssSignal(config);
              else if (config.signal_type === "market_move") signalResult = await checkMarketSignal(config);
              else if (config.signal_type === "keyword_email" || config.signal_type === "keyword_telegram") signalResult = await checkKeywordSignal(sb, config, uid, config.signal_type);
            } catch { continue; }

            await sb.from("mavis_signal_configs").update({ last_checked_at: new Date().toISOString() }).eq("id", config.id);

            if (signalResult.triggered) {
              triggered++;
              await generateAndSendBriefing(sb, uid, config.signal_type, config.name, signalResult.data ?? signalResult.items ?? signalResult.matches);
              await sb.from("mavis_signal_configs").update({ last_triggered_at: new Date().toISOString() }).eq("id", config.id);
            }
          }
          results.push({ userId: uid, configs_checked: userConfigs.length, triggered });
        }
        result = { users_processed: results.length, results };
        break;
      }
      case "get_signal_configs": {
        if (!userId) throw new Error("userId required");
        const { data } = await sb.from("mavis_signal_configs").select("*").eq("user_id", userId).order("created_at", { ascending: false });
        result = { configs: data ?? [] };
        break;
      }
      case "upsert_signal_config": {
        if (!userId) throw new Error("userId required");
        const { id, signal_type, name, source, threshold, is_active = true, cooldown_hours = 4 } = p as any;
        if (id) {
          await sb.from("mavis_signal_configs").update({ signal_type, name, source, threshold, is_active, cooldown_hours, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
          result = { updated: true, id };
        } else {
          const { data, error } = await sb.from("mavis_signal_configs").insert({ user_id: userId, signal_type, name, source, threshold, is_active, cooldown_hours }).select("id").single();
          if (error) throw new Error(error.message);
          result = { created: true, id: (data as any).id };
        }
        break;
      }
      case "delete_signal_config": {
        if (!userId) throw new Error("userId required");
        const { id } = p as any;
        if (!id) throw new Error("id required");
        await sb.from("mavis_signal_configs").delete().eq("id", id).eq("user_id", userId);
        result = { deleted: true };
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
