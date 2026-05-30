import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;
    const since = new Date();
    since.setDate(since.getDate() - 30);

    // Try finance_entries table first, fall back to store_items for revenue proxy
    const { data: financeData, error: finErr } = await supabase
      .from("finance_entries")
      .select("amount, type, category, description, date")
      .eq("user_id", uid)
      .gte("date", since.toISOString().slice(0, 10))
      .order("date", { ascending: false });

    if (finErr || !financeData) {
      // Fallback: summarize from mavis_insights finance category
      const { data: insights } = await supabase
        .from("mavis_insights")
        .select("title, content")
        .eq("user_id", uid)
        .eq("category", "finance")
        .order("generated_at", { ascending: false })
        .limit(3);

      if (insights && insights.length > 0) {
        const lines = ["FINANCE BRIEF — RECENT INSIGHTS\n"];
        for (const ins of insights) {
          lines.push(`• ${ins.title}`);
          lines.push(`  ${ins.content}\n`);
        }
        return { skillName: "finance-brief", output: lines.join("\n") };
      }

      return {
        skillName: "finance-brief",
        output: "No finance data found. Set up finance tracking in the Finance section to enable this brief.",
      };
    }

    const income = financeData.filter((e: any) => e.type === "income");
    const expenses = financeData.filter((e: any) => e.type === "expense");
    const totalIncome = income.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
    const totalExpenses = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
    const net = totalIncome - totalExpenses;

    const expByCategory: Record<string, number> = {};
    for (const e of expenses) {
      const cat = e.category ?? "uncategorized";
      expByCategory[cat] = (expByCategory[cat] ?? 0) + Number(e.amount);
    }
    const topCategories = Object.entries(expByCategory).sort(([, a], [, b]) => b - a).slice(0, 3);

    const lines: string[] = [`FINANCE BRIEF — LAST 30 DAYS\n`];
    lines.push(`INCOME:    $${totalIncome.toFixed(2)}`);
    lines.push(`EXPENSES:  $${totalExpenses.toFixed(2)}`);
    lines.push(`NET:       ${net >= 0 ? "+" : ""}$${net.toFixed(2)}\n`);

    if (topCategories.length > 0) {
      lines.push("TOP EXPENSE CATEGORIES:");
      topCategories.forEach(([cat, amount]) => lines.push(`  • ${cat}: $${amount.toFixed(2)}`));
      lines.push("");
    }

    if (net < 0) lines.push("⚠ Negative cash flow this period. Review discretionary spending.");
    else if (net > 0) lines.push("Cash flow positive. Consider deploying surplus toward active goals.");

    return { skillName: "finance-brief", output: lines.join("\n") };
  } catch (err) {
    return { skillName: "finance-brief", output: `Finance brief failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "finance-brief",
  description: "Summarizes recent financial activity — income, expenses, net flow, and top spending categories",
  keywords: ["finance brief", "money summary", "cash flow", "financial overview", "spending", "income", "expenses", "how much money", "budget"],
}, handler);
