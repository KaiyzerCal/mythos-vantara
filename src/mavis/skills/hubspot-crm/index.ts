// SKILL: hubspot-crm
// HubSpot CRM operations via Apify MCP server anchor/hubspot-apify-mcp-server.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "hubspot-crm", output: "Manage HubSpot CRM. Example: 'hubspot contacts list' or 'hubspot create contact: John Doe john@example.com' or 'hubspot deals pipeline'" };
  }
  const query = input.replace(/^(hubspot)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "anchor/hubspot-apify-mcp-server", input: { query, user_id: ctx.userId }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.result ?? data;
    return { skillName: "hubspot-crm", output: result ? `🟠 **HubSpot CRM:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "hubspot-crm", output: `HubSpot error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "hubspot-crm",
  description: "HubSpot CRM — manage contacts, deals, pipelines, and activities via MCP",
  keywords: [
    "hubspot", "hubspot crm", "hubspot contacts", "hubspot deals",
    "hubspot pipeline", "crm hubspot", "hubspot create contact",
  ],
}, handler);
