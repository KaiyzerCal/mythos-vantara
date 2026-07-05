// SKILL: invoice-collect
// Collects and processes invoices from email or URL via Apify MCP server devaditya/invoice-collector-mcp.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "invoice-collect", output: "Collect invoices. Example: 'collect invoices from email' or 'invoice collect: https://example.com/invoice.pdf' or 'process my invoices'" };
  }
  const source = input.replace(/^(collect invoices from|invoice collect|process my invoices?)\s*:?\s*/i, "").trim() || "email";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "devaditya/invoice-collector-mcp", input: { source, user_id: ctx.userId }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.invoices ?? data;
    return { skillName: "invoice-collect", output: result ? `🧾 **Invoice Collector:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "invoice-collect", output: `Invoice collect error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "invoice-collect",
  description: "Collects and processes invoices from email or URL — extracts line items, totals, dates",
  keywords: [
    "invoice collect", "collect invoices", "process invoices", "invoice processor",
    "invoice extractor", "invoice data", "invoice from email",
  ],
}, handler);
