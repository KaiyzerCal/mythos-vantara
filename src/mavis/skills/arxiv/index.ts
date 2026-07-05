// SKILL: arxiv
// Searches and summarizes academic papers from arXiv via mavis-arxiv.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "arxiv", output: "Search academic papers by topic or title. Example: 'arxiv papers on transformer architectures' or 'latest AI safety research'" };
  }
  const query = input.replace(/^(arxiv|papers on|research papers about|find papers|academic papers on)\s+/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-arxiv", {
      body: { query, limit: 5 },
    });
    if (error) throw error;
    const papers = data?.papers ?? data?.results ?? [];
    if (Array.isArray(papers) && papers.length > 0) {
      const formatted = papers.map((p: any, i: number) =>
        `**${i + 1}. ${p.title ?? p.name}**\n${p.abstract?.slice(0, 300) ?? ""}…\n[${p.url ?? p.arxiv_url ?? ""}](${p.url ?? p.arxiv_url ?? ""})`
      ).join("\n\n");
      return { skillName: "arxiv", output: `📚 **ArXiv: ${query}**\n\n${formatted}` };
    }
    return { skillName: "arxiv", output: data?.output ?? JSON.stringify(data) };
  } catch (err) {
    return { skillName: "arxiv", output: `ArXiv search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "arxiv",
  description: "Searches and summarizes academic research papers from arXiv",
  keywords: [
    "arxiv", "research papers", "academic papers", "find papers on",
    "papers about", "scientific papers", "preprints", "latest research on",
    "journal articles", "studies on", "find studies", "research literature",
  ],
}, handler);
