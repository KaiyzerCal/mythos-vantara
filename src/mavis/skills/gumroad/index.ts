// SKILL: gumroad
// Checks Gumroad sales, products, and subscriptions via mavis-gumroad.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "gumroad", output: "Access your Gumroad account. Example: 'show my gumroad sales today' or 'what are my top selling products on gumroad?'" };
  }
  const action = /sales|revenue|earnings/i.test(input) ? "sales"
    : /product/i.test(input) ? "products"
    : /subscriber|follower/i.test(input) ? "subscribers"
    : "sales";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-gumroad", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.sales ?? data?.products ?? data?.result ?? data?.output;
    return { skillName: "gumroad", output: result ? `💰 **Gumroad ${action}:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 2000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "gumroad", output: `Gumroad error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "gumroad",
  description: "Checks Gumroad sales, products, revenue, and subscriber stats",
  keywords: [
    "gumroad", "gumroad sales", "gumroad products", "my gumroad",
    "digital product sales", "gumroad earnings", "gumroad revenue",
    "gumroad subscribers", "gumroad analytics",
  ],
}, handler);
