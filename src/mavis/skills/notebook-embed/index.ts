// SKILL: notebook-embed
// Embeds notebook source content for semantic search via mavis-notebook-embed.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "notebook-embed", output: "Embed and search notebook content. Example: 'notebook search: key insights from my Q3 notes' or 'embed notebook source: [url]'" };
  }
  const isEmbed = /embed|add|index/i.test(input);
  const query = input.replace(/^(notebook embed|embed notebook|notebook search|search notebook)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-notebook-embed", {
      body: { action: isEmbed ? "embed" : "search", query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.results ?? data?.embedded ?? data?.output;
    return { skillName: "notebook-embed", output: result ? `📓 **Notebook:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "notebook-embed", output: `Notebook embed error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "notebook-embed",
  description: "Embeds notebook content for semantic search — index sources and query across your notebooks",
  keywords: [
    "notebook embed", "notebook search", "embed notebook", "search notebook",
    "notebook index", "semantic notebook", "notebook query",
  ],
}, handler);
