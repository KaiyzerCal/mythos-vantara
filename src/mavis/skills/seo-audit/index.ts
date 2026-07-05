// SKILL: seo-audit
// Audits websites for SEO issues and opportunities via mavis-seo-engine.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "seo-audit", output: "Give me a URL or keyword and I'll audit SEO. Example: 'SEO audit for example.com' or 'rank analysis for \'best coffee makers\''" };
  }
  const urlMatch = input.match(/https?:\/\/[^\s]+/) ?? input.match(/\b[\w-]+\.(?:com|io|co|net|org|dev)\b/);
  const keyword = input.replace(/^(seo audit|audit seo|seo analysis|rank for|optimize for)\s+(for\s+)?/i, "").replace(urlMatch?.[0] ?? "", "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-seo-engine", {
      body: { url: urlMatch?.[0] ?? null, keyword: keyword || null, action: urlMatch ? "audit" : "keyword_research" },
    });
    if (error) throw error;
    const result = data?.audit ?? data?.report ?? data?.result ?? data?.output;
    return { skillName: "seo-audit", output: result ? `🔍 **SEO Analysis:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "seo-audit", output: `SEO audit failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "seo-audit",
  description: "Audits websites for SEO issues, keyword opportunities, and rankings",
  keywords: [
    "seo audit", "seo analysis", "rank for", "keyword research", "page seo",
    "optimize for search", "google ranking", "seo score", "meta tags",
    "backlinks", "site seo", "keyword ranking", "search visibility",
  ],
}, handler);
