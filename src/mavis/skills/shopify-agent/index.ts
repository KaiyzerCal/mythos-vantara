// SKILL: shopify-agent
// Checks orders, inventory, and store analytics via mavis-shopify-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "shopify-agent", output: "Access your Shopify store. Example: 'show recent shopify orders' or 'check inventory for my top products'" };
  }
  const action = /order/i.test(input) ? "orders"
    : /inventor/i.test(input) ? "inventory"
    : /sales|revenue|analytics/i.test(input) ? "analytics"
    : /product/i.test(input) ? "products"
    : /customer/i.test(input) ? "customers"
    : "orders";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-shopify-agent", {
      body: { action, query: input.trim(), user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.orders ?? data?.products ?? data?.analytics ?? data?.result ?? data?.output;
    return { skillName: "shopify-agent", output: result ? `🛒 **Shopify ${action}:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "shopify-agent", output: `Shopify error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "shopify-agent",
  description: "Checks Shopify orders, inventory, customers, and store analytics",
  keywords: [
    "shopify", "shopify orders", "shopify inventory", "shopify store",
    "ecommerce orders", "check orders", "shopify analytics", "shopify customers",
    "shopify products", "online store", "store sales",
  ],
}, handler);
