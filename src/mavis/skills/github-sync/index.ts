// SKILL: github-sync
// Syncs GitHub repos, PRs, and issues into MAVIS context via mavis-github-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "github-sync", output: "Sync GitHub into MAVIS. Example: 'github sync KaiyzerCal/mythos-vantara' or 'sync my repos' or 'github issues for KaiyzerCal/rtk'" };
  }
  const repo = input.replace(/^(github sync|sync my repos?|github issues for)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-github-sync", {
      body: { repo, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.synced ?? data?.repos ?? data?.output;
    return { skillName: "github-sync", output: result ? `🐙 **GitHub Sync:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "github-sync", output: `GitHub sync error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "github-sync",
  description: "Syncs GitHub repos, PRs, issues, and commits into MAVIS memory and context",
  keywords: [
    "github sync", "sync github", "github issues", "sync repos",
    "github pull requests", "github context", "sync codebase",
  ],
}, handler);
