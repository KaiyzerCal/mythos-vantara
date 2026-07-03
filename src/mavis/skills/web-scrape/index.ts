// SKILL: web-scrape
// AI-powered web scraper via Apify's Crawl4AI — converts any URL to clean content.
// Falls back with guidance if Apify not configured.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return {
      skillName: "web-scrape",
      output: "Give me a URL (and optionally what to extract) — I'll scrape and return clean, structured content. Example: 'scrape https://example.com for pricing info'",
    };
  }

  const urlMatch = input.match(/https?:\/\/[^\s]+/);
  const targetUrl = urlMatch?.[0]?.replace(/[.,;]$/, "");
  if (!targetUrl) {
    return {
      skillName: "web-scrape",
      output: "Please include a URL to scrape. Example: 'scrape https://example.com for competitor pricing'",
    };
  }
  const extractGoal = input.replace(urlMatch![0], "").trim().replace(/^for\s+/i, "") || "Extract all meaningful content";

  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: {
        actorId: "janbuchar/crawl4ai",
        input: {
          startUrls: [{ url: targetUrl }],
          extractionGoal,
          maxCrawlPages: 3,
          outputFormat: "markdown",
        },
        timeout: 90,
      },
    });
    if (!error && data?.data?.length > 0) {
      const result = data.data[0];
      const content = result.markdown ?? result.text ?? result.content;
      if (content) {
        return {
          skillName: "web-scrape",
          output: `**SCRAPED: ${targetUrl}**\n_Goal: ${extractGoal}_\n\n${String(content).slice(0, 10000)}`,
        };
      }
    }
  } catch { /* fall through */ }

  // Fallback: route to AGENT mode with search_web for live content
  const { data: chatData, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
    body: {
      messages: [{ role: "user", content: `Extract the following from ${targetUrl}: ${extractGoal}` }],
      systemPrompt: `You are a web content extraction specialist. The user wants to extract "${extractGoal}" from ${targetUrl}.

Since you cannot directly fetch URLs in this mode, provide:
1. What the URL structure suggests about the content type
2. Key extraction strategies for this type of site
3. The most important fields/data to look for
4. Recommend using AGENT mode with search_web for live content extraction

If the URL is a known site type (e-commerce, news, social, docs), describe the typical data structure.`,
      mode: "RESEARCH",
      chatKind: "skill",
    },
  });
  if (chatErr) throw chatErr;
  return { skillName: "web-scrape", output: chatData?.content ?? "[No output]" };
};

registerSkill({
  name: "web-scrape",
  description: "AI web scraper — extracts and structures content from any URL using Crawl4AI",
  keywords: [
    "scrape this", "scrape url", "extract from website", "scrape website",
    "get content from", "crawl this page", "extract data from url",
    "scrape page", "web extract", "pull data from website", "fetch this url",
    "scrape https://", "extract from https://",
  ],
}, handler);
