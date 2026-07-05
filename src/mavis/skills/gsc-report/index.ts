// SKILL: gsc-report
// Google Search Console reporting via Apify MCP server smacient/gsc-mcp-worker.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "gsc-report", output: "Get Search Console data. Example: 'gsc top queries last 28 days' or 'search console clicks report' or 'gsc impressions by page'" };
  }
  const query = input.replace(/^(gsc|google search console|search console)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "smacient/gsc-mcp-worker", input: { query, user_id: ctx.userId }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.report ?? data;
    return { skillName: "gsc-report", output: result ? `🔍 **Search Console:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "gsc-report", output: `GSC error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "gsc-report",
  description: "Google Search Console reports — top queries, impressions, clicks, average position",
  keywords: [
    "gsc", "search console", "google search console", "seo impressions",
    "search queries report", "gsc clicks", "search console data",
  ],
}, handler);
