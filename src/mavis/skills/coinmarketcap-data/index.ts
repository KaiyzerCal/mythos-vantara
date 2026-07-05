// SKILL: coinmarketcap-data
// CoinMarketCap crypto data and AI analysis via Apify red.cars/coinmarketcap-ai-gateway.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "coinmarketcap-data", output: "Get crypto data. Example: 'coinmarketcap bitcoin' or 'cmc data for ETH' or 'top 10 cryptos coinmarketcap'" };
  }
  const query = input.replace(/^(coinmarketcap|cmc data for|cmc)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "red.cars/coinmarketcap-ai-gateway", input: { query }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.data ?? data;
    return { skillName: "coinmarketcap-data", output: result ? `🪙 **CoinMarketCap:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "coinmarketcap-data", output: `CoinMarketCap error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "coinmarketcap-data",
  description: "CoinMarketCap crypto prices, rankings, market cap, and AI-powered analysis",
  keywords: [
    "coinmarketcap", "cmc data", "crypto prices", "coin market cap",
    "crypto market cap", "top cryptos", "cmc bitcoin",
  ],
}, handler);
