// SKILL: financial-datasets-mcp
// Financial datasets — income statements, balance sheets, cash flow via Apify MCP server agentify/financial-datasets-mcp-server.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "financial-datasets-mcp", output: "Get financial datasets. Example: 'financial data AAPL income statement' or 'balance sheet MSFT' or 'cash flow Tesla 2023'" };
  }
  const query = input.replace(/^(financial data|financial datasets|get financial)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "agentify/financial-datasets-mcp-server", input: { query, user_id: ctx.userId }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.financials ?? data;
    return { skillName: "financial-datasets-mcp", output: result ? `💹 **Financial Datasets:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "financial-datasets-mcp", output: `Financial datasets error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "financial-datasets-mcp",
  description: "Financial datasets — income statements, balance sheets, cash flow, ratios for any public company",
  keywords: [
    "financial datasets", "income statement", "balance sheet", "cash flow statement",
    "financial data", "company financials", "financial ratios",
  ],
}, handler);
