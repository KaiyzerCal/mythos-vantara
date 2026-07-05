// SKILL: ga4-report
// Google Analytics 4 reporting via Apify MCP server smacient/ga4-mcp-worker.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "ga4-report", output: "Get GA4 analytics. Example: 'ga4 traffic report last 30 days' or 'google analytics sessions this week' or 'ga4 top pages'" };
  }
  const query = input.replace(/^(ga4|google analytics|ga4 report)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "smacient/ga4-mcp-worker", input: { query, user_id: ctx.userId }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.report ?? data;
    return { skillName: "ga4-report", output: result ? `📈 **GA4 Analytics:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "ga4-report", output: `GA4 error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "ga4-report",
  description: "Google Analytics 4 reports — sessions, users, conversions, top pages",
  keywords: [
    "ga4", "google analytics", "ga4 report", "analytics traffic",
    "ga4 sessions", "ga4 top pages", "website analytics report",
  ],
}, handler);
