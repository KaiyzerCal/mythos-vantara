import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase } from "@/integrations/supabase/client";

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const uid = ctx.userId;
    const { data: revenue } = await supabase
      .from("mavis_revenue")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!revenue || revenue.length === 0) {
      return {
        skillName: "revenue-report",
        output: `REVENUE REPORT — CODEXOS INCOME TRACKER

No revenue events recorded yet. MAVIS revenue tracking is live and ready.

Revenue streams available to activate:
  • SkyforgeAI subscriptions (SMB revenue automation)
  • Bioneer subscriptions (human performance coaching)
  • Vantara direct sales
  • Skill sales via marketplace
  • Service engagements / consulting

Revenue will be logged here automatically when Stripe webhooks are configured.`,
      };
    }

    const total = revenue.reduce((sum: number, r: any) => sum + Number(r.amount), 0);
    const bySource: Record<string, number> = {};
    for (const r of revenue) {
      bySource[r.source] = (bySource[r.source] ?? 0) + Number(r.amount);
    }

    const breakdown = Object.entries(bySource)
      .sort(([, a], [, b]) => b - a)
      .map(([source, amount]) => `  • ${source}: $${amount.toFixed(2)}`)
      .join("\n");

    const recent = revenue.slice(0, 5)
      .map((r: any) => `  • $${Number(r.amount).toFixed(2)} — ${r.description} (${new Date(r.created_at).toLocaleDateString()})`)
      .join("\n");

    return {
      skillName: "revenue-report",
      output: `REVENUE REPORT — CODEXOS INCOME TRACKER

TOTAL GENERATED: $${total.toFixed(2)}

BY SOURCE:
${breakdown}

RECENT TRANSACTIONS:
${recent}

Status: Revenue engine operational.`,
    };
  } catch (err) {
    return { skillName: "revenue-report", output: `Revenue report unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "revenue-report",
  description: "Generates full revenue report across all MAVIS income streams",
  keywords: ["revenue", "revenue report", "money", "income", "earnings", "how much have we made", "sales report", "profit"],
}, handler);
