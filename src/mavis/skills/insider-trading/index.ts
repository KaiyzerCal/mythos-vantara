// SKILL: insider-trading
// Tracks insider trading and institutional stock activity via Apify rotas/insider-finance-us-stock-monitoring.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "insider-trading", output: "Check insider trading activity. Example: 'insider trades for AAPL' or 'institutional activity for TSLA' or 'insider buying NVDA'" };
  }
  const ticker = input.match(/\b[A-Z]{1,5}\b/)?.[0] ?? input.replace(/^(insider trades for|insider trading|institutional activity for)\s*/i, "").trim().toUpperCase();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "rotas/insider-finance-us-stock-monitoring", input: { ticker }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.trades ?? data;
    return { skillName: "insider-trading", output: result ? `📈 **Insider Activity (${ticker}):**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "insider-trading", output: `Insider trading error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "insider-trading",
  description: "Tracks insider trading and institutional activity — Form 4 filings, large buys/sells",
  keywords: [
    "insider trading", "insider trades", "institutional activity", "insider buying",
    "form 4 filing", "insider selling", "stock insider activity",
  ],
}, handler);
