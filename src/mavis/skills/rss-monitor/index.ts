// SKILL: rss-monitor
// Monitors RSS feeds and surfaces new items via mavis-rss-monitor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "rss-monitor", output: "Monitor RSS feeds. Example: 'rss monitor techcrunch.com' or 'add rss feed https://example.com/feed'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  const query = input.replace(/^(rss monitor|add rss|check rss|rss feed)\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-rss-monitor", {
      body: { feed_url: url, query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.items ?? data?.feed ?? data?.output;
    return { skillName: "rss-monitor", output: result ? `📡 **RSS Monitor:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "rss-monitor", output: `RSS monitor error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "rss-monitor",
  description: "Monitors RSS feeds and surfaces new articles and items",
  keywords: [
    "rss feed", "rss monitor", "add rss", "monitor feed", "news feed",
    "rss digest", "feed updates", "blog feed", "podcast feed rss",
  ],
}, handler);
