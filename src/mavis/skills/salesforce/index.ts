// SKILL: salesforce
// Queries and manages Salesforce CRM data via mavis-salesforce.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "salesforce", output: "Query Salesforce. Example: 'salesforce: show open opportunities over $50k' or 'salesforce contacts for Acme Corp'" };
  }
  const query = input.replace(/^(salesforce|sfdc|salesforce query)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-salesforce", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.records ?? data?.result ?? data?.output;
    return { skillName: "salesforce", output: result ? `☁️ **Salesforce:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "salesforce", output: `Salesforce error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "salesforce",
  description: "Queries and manages Salesforce CRM — leads, opportunities, contacts, and accounts",
  keywords: [
    "salesforce", "sfdc", "salesforce crm", "salesforce query", "salesforce leads",
    "salesforce opportunities", "salesforce contacts", "crm salesforce",
  ],
}, handler);
