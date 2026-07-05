// SKILL: bank-connect
// Connects bank accounts and retrieves financial data via Plaid (mavis-plaid).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "bank-connect", output: "Connect bank or get transactions. Example: 'bank transactions this month' or 'connect my bank account'" };
  }
  const action = /connect|link/i.test(input) ? "connect" : "transactions";
  const query = input.replace(/^(bank connect|connect bank|plaid|bank transactions|bank)\s*/i, "").trim() || "";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-plaid", {
      body: { action, query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.transactions ?? data?.accounts ?? data?.link_token ?? data?.output;
    return { skillName: "bank-connect", output: result ? `🏦 **Bank Connect:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "bank-connect", output: `Bank connect error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "bank-connect",
  description: "Connects bank accounts via Plaid and retrieves transactions, balances, and financial data",
  keywords: [
    "bank connect", "connect bank", "bank account", "plaid", "bank transactions",
    "my transactions", "spending data", "bank balance", "link bank",
  ],
}, handler);
