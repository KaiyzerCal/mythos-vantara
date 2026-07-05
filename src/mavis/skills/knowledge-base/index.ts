// SKILL: knowledge-base
// Queries and manages the MAVIS knowledge base via mavis-knowledge.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "knowledge-base", output: "Query your knowledge base. Example: 'knowledge base: what do I know about fundraising?' or 'search my notes for product strategy'" };
  }
  const query = input.replace(/^(knowledge base|search knowledge|search my notes|query knowledge)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-knowledge", {
      body: { query, user_id: ctx.userId, top_k: 10 },
    });
    if (error) throw error;
    const result = data?.results ?? data?.answer ?? data?.chunks ?? data?.output;
    return { skillName: "knowledge-base", output: result ? `🧠 **Knowledge Base:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "knowledge-base", output: `Knowledge base error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "knowledge-base",
  description: "Queries the MAVIS knowledge base — surfaces relevant notes, docs, and saved context",
  keywords: [
    "knowledge base", "search my notes", "query knowledge", "my knowledge",
    "search knowledge", "what do i know about", "knowledge search",
    "recall knowledge", "knowledge vault", "search my docs",
  ],
}, handler);
