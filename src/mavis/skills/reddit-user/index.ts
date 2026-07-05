// SKILL: reddit-user
// Analyzes Reddit user profiles and posting patterns via Apify nextapi/reddit-user-analyzer.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "reddit-user", output: "Analyze a Reddit user. Example: 'analyze reddit user u/username' or 'reddit profile analysis: spez' or 'reddit user insights for username'" };
  }
  const username = input.replace(/^(analyze reddit user|reddit profile analysis|reddit user insights for)\s*:?\s*(u\/)?/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "nextapi/reddit-user-analyzer", input: { username }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.analysis ?? data;
    return { skillName: "reddit-user", output: result ? `🤖 **Reddit User Analysis (u/${username}):**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "reddit-user", output: `Reddit user error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "reddit-user",
  description: "Analyzes Reddit user profiles — posting history, subreddits, karma, interests",
  keywords: [
    "reddit user analysis", "analyze reddit user", "reddit profile", "reddit user analyzer",
    "reddit user insights", "reddit karma analysis", "reddit user research",
  ],
}, handler);
