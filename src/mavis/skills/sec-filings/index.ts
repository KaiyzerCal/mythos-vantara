// SKILL: sec-filings
// Fetches and analyzes SEC filings for any public company via mavis-sec-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "sec-filings", output: "Look up SEC filings. Example: 'SEC filings for Tesla' or 'Apple 10-K filing'" };
  }
  const company = input.replace(/^(sec filings|sec filing|10-k|10-q|annual report|sec)\s+(for\s+)?/i, "").trim() || input;
  const filingType = /10-k|annual/i.test(input) ? "10-K" : /10-q|quarterly/i.test(input) ? "10-Q" : "latest";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-sec-agent", {
      body: { company, filing_type: filingType },
    });
    if (error) throw error;
    const result = data?.filing ?? data?.summary ?? data?.output;
    return { skillName: "sec-filings", output: result ? `📑 **SEC Filing — ${company}:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "sec-filings", output: `SEC filing error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "sec-filings",
  description: "Fetches and summarizes SEC filings (10-K, 10-Q, 8-K) for public companies",
  keywords: [
    "sec filing", "sec filings", "10-k", "10-q", "annual report", "quarterly report",
    "sec edgar", "public company filings", "financial disclosure", "8-k filing",
  ],
}, handler);
