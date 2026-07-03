// SKILL: crypto-intel
// Crypto & DeFi market intelligence via Apify's Crypto Intel agent.
// Falls back to MAVIS SOVEREIGN mode if Apify not configured.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const SYSTEM_PROMPT = `You are an enterprise-grade cryptocurrency and DeFi market intelligence analyst. Analyze the provided asset(s) and output:

**CRYPTO INTELLIGENCE REPORT**

**Asset(s):** [Name / Ticker / Protocol]
**Sentiment:** [Bullish / Bearish / Neutral + reasoning]
**Key Price Levels:** [support, resistance, recent action]
**On-Chain Signals:** [transaction volume, active addresses, whale movements if known]
**DeFi / Protocol Status:** [TVL, yield rates, risks if applicable]
**Social Sentiment:** [Reddit, X/Twitter, community narrative]
**Risk Factors:** [top 3 risks — technical, regulatory, market]
**Opportunity Signals:** [catalysts, setups, upcoming events]
**Action Summary:** [what to watch and when]

Use data-driven language. Flag anything speculative clearly.`;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return {
      skillName: "crypto-intel",
      output: "Tell me which coins, tokens, or DeFi protocols to analyze — I'll produce a market intelligence report covering sentiment, on-chain signals, risk factors, and opportunities.",
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "fiery_dream/crypto-intel", input: { query: input.trim() }, timeout: 60 },
    });
    if (!error && data?.data?.length > 0) {
      const result = data.data[0];
      const text = result.report ?? result.analysis ?? result.text ?? JSON.stringify(result, null, 2);
      return { skillName: "crypto-intel", output: text };
    }
  } catch { /* fall through to mavis-chat */ }

  const { data: chatData, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages: [{ role: "user", content: input }],
      systemPrompt: SYSTEM_PROMPT,
      mode: "SOVEREIGN",
      chatKind: "skill",
    },
  });
  if (chatErr) throw chatErr;
  return { skillName: "crypto-intel", output: chatData?.content ?? "[No output]" };
};

registerSkill({
  name: "crypto-intel",
  description: "Crypto and DeFi market intelligence — price action, sentiment, on-chain signals, and risk analysis",
  keywords: [
    "crypto", "bitcoin", "ethereum", "defi", "token analysis", "altcoin",
    "crypto market", "coin analysis", "crypto intelligence", "blockchain analysis",
    "web3 market", "crypto signals", "solana", "crypto report", "nft market",
    "crypto intel", "defi analysis", "crypto research",
  ],
}, handler);
