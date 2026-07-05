// SKILL: ingest-url
// Ingests any URL into the MAVIS knowledge base via mavis-ingest-url.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "ingest-url", output: "Ingest a URL into your knowledge base. Example: 'ingest https://article.com' or 'save this page: https://...' " };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0];
  if (!url) return { skillName: "ingest-url", output: "Please provide a valid URL to ingest." };
  try {
    const { data, error } = await supabase.functions.invoke("mavis-ingest-url", {
      body: { url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.status ?? data?.message ?? data?.output;
    return { skillName: "ingest-url", output: result ? `✅ **URL Ingested:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "ingest-url", output: `Ingest URL error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "ingest-url",
  description: "Ingests any URL — article, page, or doc — into the MAVIS knowledge base",
  keywords: [
    "ingest url", "save this url", "add to knowledge base", "ingest article",
    "save page", "index url", "ingest link", "add article", "save to knowledge",
  ],
}, handler);
