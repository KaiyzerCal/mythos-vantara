// SKILL: website-qa
// Runs QA checks against any website — links, performance, UX issues via mavis-website-qa.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "website-qa", output: "QA test a website. Example: 'website qa https://mysite.com' or 'check my site for broken links'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? input.replace(/^(website qa|qa test|check site|audit site)\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-website-qa", {
      body: { url, checks: ["links", "performance", "accessibility", "seo"] },
    });
    if (error) throw error;
    const result = data?.report ?? data?.issues ?? data?.output;
    return { skillName: "website-qa", output: result ? `🔍 **Website QA Report:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "website-qa", output: `Website QA error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "website-qa",
  description: "Runs automated QA checks on websites — broken links, performance, accessibility, SEO",
  keywords: [
    "website qa", "site audit", "broken links", "website check", "qa test website",
    "check my site", "website health", "site quality", "page speed check",
  ],
}, handler);
