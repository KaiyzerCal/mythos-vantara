// SKILL: summarise
// Intelligent summarizer for documents, URLs, or pasted text via mavis-chat.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "summarise", output: "Summarize content. Example: 'summarise: [paste long text]' or 'tldr: [article text]' or 'summarize in 3 bullets: [content]'" };
  }
  const content = input.replace(/^(summarise|summarize|tldr|summary)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: `Summarize the following:\n\n${content}` }],
        systemPrompt: "You are a master summarizer. Extract the most important ideas, key takeaways, and actionable insights. Format as: 1-sentence overview, then bullet-point key points, then 1-sentence bottom line. Be concise but complete.",
        mode: "PRIME",
        chatKind: "skill",
        user_id: ctx.userId,
      },
    });
    if (error) throw error;
    const result = data?.message ?? data?.output ?? data?.content;
    return { skillName: "summarise", output: result ? `📋 **Summary:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "summarise", output: `Summarise error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "summarise",
  description: "Intelligent summarizer — overview, key bullets, and bottom line for any content",
  keywords: [
    "summarise", "summarize", "tldr", "summary", "summarize text",
    "key points", "main points", "bullet summary",
  ],
}, handler);
