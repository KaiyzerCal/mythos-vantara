// SKILL: influencer-research
// Discover TikTok and Instagram influencers matching brand criteria.
// Via Apify Influencer Discovery Agent with mavis-chat fallback.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const SYSTEM_PROMPT = `You are an influencer marketing research specialist. Based on the user's criteria:

**INFLUENCER RESEARCH BRIEF**

**Target Profile:**
• Niche / category:
• Audience size tier: [nano <10K | micro 10K-100K | macro 100K-1M | mega 1M+]
• Primary platform: [TikTok | Instagram | YouTube | X | LinkedIn]
• Audience demographics: [age, location, interests]
• Tone & values: [what brand alignment is needed]

**Discovery Strategy:**
• Top hashtags to search:
• Creator archetypes that convert in this niche:
• Engagement benchmarks: [good ER% by tier]
• Red flags to avoid:

**Vetting Checklist:**
□ Engagement rate (by tier benchmark)
□ Audience authenticity score
□ Content consistency
□ Brand safety (past controversies)
□ Audience overlap with target customer

**Outreach Approach:**
• Best DM / email opener for this niche:
• Collaboration format (UGC, sponsored post, affiliate, brand deal):
• Rate benchmarks:

**Recommended Search Sources:**
• Creator marketplaces: [Grin, AspireIQ, Upfluence, Creator.co, #paid]
• Native platform search strategies`;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return {
      skillName: "influencer-research",
      output: "Describe the influencers you need — niche, platform, audience size, tone — and I'll find matching profiles and give you an outreach strategy.",
    };
  }

  // Detect platform preference
  const platformMatch = input.toLowerCase().match(/\b(tiktok|instagram|youtube|twitter|linkedin|x\.com)\b/);
  const platform = platformMatch?.[1] ?? "tiktok";

  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: {
        actorId: "apify/influencer-discovery-agent",
        input: { query: input.trim(), platform },
        timeout: 90,
      },
    });
    if (!error && data?.data?.length > 0) {
      const results = data.data as Array<Record<string, unknown>>;
      const lines = results.slice(0, 15).map((r) => {
        const handle = r.username ?? r.handle ?? r.name;
        const followers = typeof r.followers === "number" ? r.followers.toLocaleString() : r.followers;
        const er = r.engagementRate ?? r.engagement_rate;
        const bio = r.bio ?? r.description ?? "";
        return `**@${handle}** — ${followers ? `${followers} followers` : ""} ${er ? `| ER: ${er}%` : ""}\n  ${bio}`;
      });
      return {
        skillName: "influencer-research",
        output: `**INFLUENCER DISCOVERY — ${platform.toUpperCase()}**\n_Query: ${input}_\n\n${lines.join("\n\n")}`,
      };
    }
  } catch { /* fall through to mavis-chat */ }

  const { data: chatData, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages: [{ role: "user", content: input }],
      systemPrompt: SYSTEM_PROMPT,
      mode: "MARKET",
      chatKind: "skill",
    },
  });
  if (chatErr) throw chatErr;
  return { skillName: "influencer-research", output: chatData?.content ?? "[No output]" };
};

registerSkill({
  name: "influencer-research",
  description: "Discover TikTok and Instagram influencers matching brand criteria — with audience analysis, vetting, and outreach strategy",
  keywords: [
    "find influencers", "influencer research", "influencer discovery", "find creators",
    "tiktok influencers", "instagram influencers", "brand ambassadors", "micro influencers",
    "influencer outreach", "creator research", "ugc creators", "find content creators",
    "influencer marketing", "find brand partners", "creator discovery",
  ],
}, handler);
