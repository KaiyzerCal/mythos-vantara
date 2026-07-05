// SKILL: crm-lookup
// Searches and manages CRM contacts and deals via mavis-crm-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "crm-lookup", output: "Search your CRM. Example: 'find contact John Smith in CRM' or 'show deals closing this month'" };
  }
  const action = /deal|pipeline|opportunity|close/i.test(input) ? "list_deals"
    : /add|create|new contact/i.test(input) ? "create_contact"
    : "search_contacts";
  const emailMatch = input.match(/[\w.-]+@[\w.-]+\.\w+/);
  try {
    const { data, error } = await supabase.functions.invoke("mavis-crm-agent", {
      body: { action, query: input.trim(), email: emailMatch?.[0] ?? undefined, userId: ctx.userId },
    });
    if (error) throw error;
    const result = data?.contacts ?? data?.deals ?? data?.contact ?? data?.result ?? data?.output;
    return { skillName: "crm-lookup", output: result ? `👤 **CRM Result:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 2000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "crm-lookup", output: `CRM error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "crm-lookup",
  description: "Searches contacts, deals, and pipeline data in your CRM",
  keywords: [
    "crm", "find contact", "search crm", "contact lookup", "add to crm",
    "crm deal", "pipeline", "sales deal", "contact info", "crm record",
    "hubspot", "salesforce", "crm data",
  ],
}, handler);
