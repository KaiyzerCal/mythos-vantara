// SKILL: social-email-scrape
// Scrapes email addresses from social media profiles via Apify scraper-mind/all-social-media-email-scraper.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "social-email-scrape", output: "Scrape emails from social profiles. Example: 'scrape emails from https://instagram.com/username' or 'social email scrape: https://twitter.com/handle'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? input.replace(/^(social email scrape|scrape emails from)\s*:?\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "scraper-mind/all-social-media-email-scraper", input: { url }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.emails ?? data;
    return { skillName: "social-email-scrape", output: result ? `📬 **Social Email Scrape:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "social-email-scrape", output: `Social email scrape error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "social-email-scrape",
  description: "Scrapes email addresses from Instagram, Twitter, LinkedIn, and other social profiles",
  keywords: [
    "social email scrape", "scrape emails social media", "instagram email scraper",
    "twitter email scrape", "social media email finder", "profile email scraper",
  ],
}, handler);
