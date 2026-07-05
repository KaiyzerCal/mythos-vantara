// SKILL: job-search-agent
// AI-powered job search across multiple platforms via Apify louisdeconinck/ai-job-search-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "job-search-agent", output: "Search for jobs. Example: 'find jobs: AI engineer in San Francisco' or 'job search: remote product manager'" };
  }
  const query = input.replace(/^(find jobs|job search|search jobs)\s*:?\s*/i, "").trim() || input;
  const locationMatch = query.match(/\bin\s+([^,]+)/i);
  const jobTitle = query.replace(/\bin\s+[^,]+/i, "").trim();
  const location = locationMatch?.[1]?.trim() ?? "Remote";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "louisdeconinck/ai-job-search-agent", input: { jobTitle, location }, timeout: 120 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.jobs ?? data;
    return { skillName: "job-search-agent", output: result ? `💼 **Job Search Results:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "job-search-agent", output: `Job search error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "job-search-agent",
  description: "AI job search agent — searches LinkedIn, Indeed, and more for matching positions",
  keywords: [
    "job search", "find jobs", "search jobs", "ai job search",
    "job listings", "find positions", "career search",
  ],
}, handler);
