// SKILL: news-brief
// Pattern from 500-AI-Agents #06 — news summarizer agent.
// Calls mavis-morning-digest or mavis-rss-monitor for topic-specific news briefings.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const topic = input?.trim() || "AI, business, technology";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-morning-digest", {
      body: { userId: ctx.userId, topics: topic, mode: "brief" },
    });
    if (error) throw error;
    return { skillName: "news-brief", output: data?.digest ?? data?.summary ?? data?.output ?? JSON.stringify(data) };
  } catch {
    try {
      const { data, error: rssErr } = await supabase.functions.invoke("mavis-rss-monitor", {
        body: { query: topic, limit: 10 },
      });
      if (rssErr) throw rssErr;
      return { skillName: "news-brief", output: data?.digest ?? data?.summary ?? data?.output ?? JSON.stringify(data) };
    } catch (err) {
      return { skillName: "news-brief", output: `News brief failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
};

registerSkill({
  name: "news-brief",
  description: "Fetches and summarizes current news on any topic — organized briefing with key themes and insights",
  keywords: [
    "news", "what's happening", "latest news", "news brief", "news about",
    "what's in the news", "summarize the news", "morning news", "news digest",
    "current events", "what happened today", "news on", "news briefing",
  ],
}, handler);
