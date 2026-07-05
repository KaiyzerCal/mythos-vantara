// SKILL: hn-digest
// Fetches top Hacker News stories and summarizes them via mavis-hn-digest.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "hn-digest", output: "Get top Hacker News stories. Example: 'hacker news digest' or 'top HN stories today'" };
  }
  const limit = parseInt(input.match(/\d+/)?.[0] ?? "10");
  try {
    const { data, error } = await supabase.functions.invoke("mavis-hn-digest", {
      body: { limit: Math.min(limit || 10, 30) },
    });
    if (error) throw error;
    const result = data?.stories ?? data?.digest ?? data?.output;
    return { skillName: "hn-digest", output: result ? `📰 **Hacker News Digest:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "hn-digest", output: `HN digest error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "hn-digest",
  description: "Fetches and summarizes top Hacker News stories",
  keywords: [
    "hacker news", "hn digest", "top hn", "hacker news today", "hn stories",
    "tech news hacker news", "hackernews", "show hn", "ask hn",
  ],
}, handler);
