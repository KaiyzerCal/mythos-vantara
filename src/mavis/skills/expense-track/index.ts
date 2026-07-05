// SKILL: expense-track
// Categorizes and tracks expenses via mavis-expense-categorize.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "expense-track", output: "Log or categorize an expense. Example: 'track expense: $45 at Whole Foods' or 'categorize: $120 Adobe subscription'" };
  }
  const amountMatch = input.match(/\$?([\d,]+(?:\.\d{2})?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(",", "")) : null;
  const description = input.replace(/^(track expense|log expense|categorize|add expense)\s*:?\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-expense-categorize", {
      body: { description, amount, user_id: ctx.userId },
    });
    if (error) throw error;
    const category = data?.category ?? data?.result?.category;
    const note = data?.note ?? data?.result?.note;
    return {
      skillName: "expense-track",
      output: category
        ? `💳 **Expense Logged:**\n${description}${amount ? ` — $${amount}` : ""}\nCategory: **${category}**${note ? `\nNote: ${note}` : ""}`
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "expense-track", output: `Expense tracking error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "expense-track",
  description: "Logs and categorizes expenses with AI auto-categorization",
  keywords: [
    "track expense", "log expense", "expense", "categorize purchase",
    "add expense", "spent", "i bought", "paid for", "charge",
    "receipt", "spending", "expense log",
  ],
}, handler);
