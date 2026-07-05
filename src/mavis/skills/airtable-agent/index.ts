// SKILL: airtable-agent
// Reads, creates, and updates Airtable records via mavis-airtable-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "airtable-agent", output: "Manage Airtable records. Example: 'search airtable for leads from last week' or 'add record to my Airtable CRM'" };
  }
  const action = /add|create|insert|new record/i.test(input) ? "create" : /update|edit|change/i.test(input) ? "update" : "search";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-airtable-agent", {
      body: { action, query: input.trim(), user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.records ?? data?.record ?? data?.result ?? data?.output;
    return { skillName: "airtable-agent", output: result ? `📋 **Airtable:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "airtable-agent", output: `Airtable error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "airtable-agent",
  description: "Reads, creates, and updates Airtable database records",
  keywords: [
    "airtable", "airtable record", "airtable database", "query airtable",
    "add to airtable", "update airtable", "search airtable", "airtable view",
    "airtable crm", "airtable table",
  ],
}, handler);
