// SKILL: reddit
// Fetches and summarizes Reddit posts and threads via mavis-reddit-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "reddit", output: "Browse Reddit. Example: 'reddit r/startups top posts' or 'reddit search: AI tools 2024'" };
  }
  const subreddit = input.match(/r\/(\w+)/i)?.[1] ?? null;
  const query = input.replace(/^(reddit|browse reddit|show reddit)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-reddit-agent", {
      body: { query, subreddit, limit: 10 },
    });
    if (error) throw error;
    const result = data?.posts ?? data?.results ?? data?.output;
    return { skillName: "reddit", output: result ? `🔴 **Reddit:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "reddit", output: `Reddit error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "reddit",
  description: "Fetches and summarizes Reddit posts, threads, and subreddit content",
  keywords: [
    "reddit", "subreddit", "r/", "reddit search", "browse reddit",
    "reddit posts", "reddit thread", "what's on reddit", "reddit digest",
  ],
}, handler);
