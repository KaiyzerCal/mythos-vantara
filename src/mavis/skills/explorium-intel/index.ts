// SKILL: explorium-intel
// Business intelligence and data enrichment via Apify MCP server agentify/explorium-mcp-server.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "explorium-intel", output: "Get business intelligence. Example: 'explorium intel: company Apple Inc' or 'enrich company data: Tesla' or 'explorium: market sizing for SaaS'" };
  }
  const query = input.replace(/^(explorium intel|enrich company data|explorium)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "agentify/explorium-mcp-server", input: { query, user_id: ctx.userId }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.intelligence ?? data;
    return { skillName: "explorium-intel", output: result ? `🔭 **Explorium Intelligence:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "explorium-intel", output: `Explorium error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "explorium-intel",
  description: "Business intelligence and company data enrichment via Explorium — firmographics, signals",
  keywords: [
    "explorium intel", "explorium", "company data enrichment", "business intelligence enrichment",
    "enrich company", "b2b data", "company intelligence",
  ],
}, handler);
