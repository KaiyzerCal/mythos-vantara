// SKILL: web-crawl
// Deep website crawler — follows links and extracts structured content via mavis-web-crawler.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "web-crawl", output: "Crawl a website. Example: 'crawl https://docs.myproduct.com' or 'web crawl https://competitor.com/blog'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? input.replace(/^(crawl|web crawl|crawl site)\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-web-crawler", {
      body: { url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.pages ?? data?.content ?? data?.output;
    return { skillName: "web-crawl", output: result ? `🕷️ **Web Crawl:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "web-crawl", output: `Web crawl error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "web-crawl",
  description: "Deep website crawler — follows internal links and extracts structured page content",
  keywords: [
    "web crawl", "crawl website", "crawl site", "site crawl",
    "deep crawl", "crawl docs", "website crawler",
  ],
}, handler);
