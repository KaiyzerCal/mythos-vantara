// SKILL: job-search-agent
// LinkedIn job search via the Apify Actor johnvc/linkedin-jobs-api.

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
  const remote = /remote/i.test(location);
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: {
        actorId: "johnvc/linkedin-jobs-api",
        input: { keyword: jobTitle, ...(remote ? { remote: true } : { location }), maxJobs: 10 },
        timeout: 120,
      },
    });
    if (error) throw error;
    const jobs = (Array.isArray(data?.data) ? data.data : []).filter((j: any) => j?.title);
    if (!jobs.length) return { skillName: "job-search-agent", output: `No jobs found for "${jobTitle}"${remote ? " (remote)" : ` in ${location}`}.` };
    const lines = jobs.map((j: any, i: number) =>
      `${i + 1}. **${j.title}** at ${j.companyName ?? "unknown company"} (${j.location ?? "location not listed"})${j.postedDate ? `, posted ${j.postedDate}` : ""}\n   ${j.jobUrl ?? ""}`);
    return { skillName: "job-search-agent", output: `💼 **Job Search Results:**\n\n${lines.join("\n")}` };
  } catch (err) {
    return { skillName: "job-search-agent", output: `Job search error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "job-search-agent",
  description: "Job search agent — searches LinkedIn job listings for matching positions",
  keywords: [
    "job search", "find jobs", "search jobs", "ai job search",
    "job listings", "find positions", "career search",
  ],
}, handler);
