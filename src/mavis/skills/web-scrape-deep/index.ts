// SKILL: web-scrape-deep
// AI-powered deep web scraper with structured data extraction via mavis-web-scraper.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "web-scrape-deep", output: "Scrape structured data from a webpage. Example: 'scrape https://example.com/pricing' or 'deep scrape product data from https://shop.com'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? input.replace(/^(scrape|deep scrape|web scrape)\s*(data\s+from\s+)?/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-web-scraper", {
      body: { url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.data ?? data?.content ?? data?.output;
    return { skillName: "web-scrape-deep", output: result ? `🔍 **Web Scrape:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "web-scrape-deep", output: `Web scrape error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "web-scrape-deep",
  description: "AI-powered deep web scraper — extracts structured data, tables, prices, and text",
  keywords: [
    "deep scrape", "web scrape", "scrape data", "extract data from website",
    "scrape page", "web scraper", "scrape structured data",
  ],
}, handler);
