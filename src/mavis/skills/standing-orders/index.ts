// SKILL: standing-orders
// Views and triggers the standing order scheduler for recurring templates via mavis-so-scheduler.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "standing-orders", output: "Manage standing orders. Example: 'show standing orders' or 'trigger standing orders now' or 'my recurring automations'" };
  }
  const action = /trigger|run now|execute/i.test(input) ? "trigger" : "list";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-so-scheduler", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.orders ?? data?.triggered ?? data?.output;
    return { skillName: "standing-orders", output: result ? `📋 **Standing Orders:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "standing-orders", output: `Standing orders error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "standing-orders",
  description: "Views and triggers the standing order scheduler — recurring automation templates that run on schedule",
  keywords: [
    "standing orders", "recurring automations", "show standing orders", "trigger standing orders",
    "scheduled templates", "automation schedule", "my automations",
  ],
}, handler);
