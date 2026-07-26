// SKILL: invoice-generator
// Generates a professional invoice as JSON and HTML based on items, client, and terms.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const query = input?.replace(/^\/?(invoice|generate invoice|create invoice)\s*:?\s*/i, "").trim() || "help me generate an invoice";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: query }],
        systemPrompt: `You are an invoice-generation assistant. Extract line items, client details, rates, quantities, and terms from the user's message. Return:
1. A clean JSON object with fields: client, invoice_number, date, due_date, items (array of {description, quantity, rate, amount}), subtotal, tax, total, notes.
2. A short HTML invoice snippet they can copy into an email or document.
If any required field is missing, ask the user for it.`,
        mode: "PRIME",
        chatKind: "skill",
      },
    });
    if (error) throw error;
    return { skillName: "invoice-generator", output: data?.content ?? "[No response]" };
  } catch (err) {
    return { skillName: "invoice-generator", output: `Invoice generator error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "invoice-generator",
  description: "Generates professional invoices with line items, totals, tax, and HTML output",
  keywords: [
    "generate invoice", "create invoice", "invoice generator", "make invoice",
    "send invoice", "invoice template", "client invoice",
  ],
}, handler);
