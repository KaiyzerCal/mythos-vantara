// SKILL: article-extract
// Extracts clean readable article content from any URL via mavis-article-extractor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "article-extract", output: "Extract article content. Example: 'extract article: https://techcrunch.com/...' or 'read this article: [url]'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0];
  if (!url) return { skillName: "article-extract", output: "Please provide a URL to extract." };
  try {
    const { data, error } = await supabase.functions.invoke("mavis-article-extractor", {
      body: { url, user_id: ctx.userId, save_to_knowledge: true },
    });
    if (error) throw error;
    const result = data?.article ?? data?.content ?? data?.text ?? data?.output;
    return { skillName: "article-extract", output: result ? `📰 **Article Extracted:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "article-extract", output: `Article extract error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "article-extract",
  description: "Extracts clean article title and body from any URL — strips ads, nav, and clutter",
  keywords: [
    "extract article", "read article", "article extract", "get article text",
    "extract content", "read this url", "article reader", "clean article",
  ],
}, handler);
