// SKILL: content-processor
// AI content processing — summarize, classify, extract, rewrite via Apify valid_headlamp/ai-content-processor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "content-processor", output: "Process content with AI. Example: 'process content: summarize [text]' or 'content processor: classify [text]' or 'extract entities from: [text]'" };
  }
  const taskMatch = input.match(/^(summarize|classify|extract|rewrite)\s/i);
  const task = taskMatch?.[1]?.toLowerCase() ?? "summarize";
  const text = input.replace(/^(process content|content processor|extract entities from)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "valid_headlamp/ai-content-processor", input: { text, task }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.result ?? data;
    return { skillName: "content-processor", output: result ? `⚙️ **Content Processed:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "content-processor", output: `Content processor error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "content-processor",
  description: "AI content processor — summarize, classify, extract entities, or rewrite any text",
  keywords: [
    "content processor", "process content", "ai content processing", "extract entities",
    "classify content", "content extraction", "ai text processing",
  ],
}, handler);
