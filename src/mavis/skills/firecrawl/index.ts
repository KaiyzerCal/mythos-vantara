// SKILL: firecrawl
// Deep web crawling and structured data extraction via mavis-firecrawl-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "firecrawl", output: "Deep-crawl any website for structured data. Example: 'firecrawl https://competitor.com/pricing' or 'crawl and extract all job listings from https://jobs.site.com'" };
  }
  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return { skillName: "firecrawl", output: "Please include a URL to crawl. Example: 'crawl https://example.com for all product prices'" };
  const goal = input.replace(urlMatch[0], "").replace(/^(crawl|firecrawl|scrape|extract from)\s*/i, "").replace(/^(for|and extract|and get)\s+/i, "").trim() || "Extract all meaningful content";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-firecrawl-agent", {
      body: { url: urlMatch[0], extraction_goal: goal, format: "markdown", max_pages: 5 },
    });
    if (error) throw error;
    const content = data?.markdown ?? data?.content ?? data?.output;
    return { skillName: "firecrawl", output: content ? `🔥 **Crawled: ${urlMatch[0]}**\n_Goal: ${goal}_\n\n${String(content).slice(0, 8000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "firecrawl", output: `Firecrawl error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "firecrawl",
  description: "Deep-crawls websites and extracts structured content using Firecrawl",
  keywords: [
    "firecrawl", "deep crawl", "crawl this website", "extract from site",
    "crawl and extract", "full site extraction", "scrape entire site",
    "crawl all pages", "extract content from", "deep scrape",
  ],
}, handler);
