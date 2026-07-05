// SKILL: notion-sync
// Creates, updates, and queries Notion pages via mavis-notion-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "notion-sync", output: "Tell me what to do in Notion. Example: 'add to notion: Meeting notes for Tuesday' or 'find my Notion page about project X'" };
  }
  const isSearch = /find|search|get|look up|show/i.test(input);
  const action = isSearch ? "search" : "create";
  const content = input.replace(/^(add to notion|create notion page|notion page|save to notion)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-notion-agent", {
      body: { action, content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.page ?? data?.pages ?? data?.result ?? data?.output;
    return {
      skillName: "notion-sync",
      output: result
        ? (action === "create" ? `📝 **Saved to Notion:** ${typeof result === "string" ? result : JSON.stringify(result)}` : `🔍 **Notion Results:**\n${JSON.stringify(result, null, 2).slice(0, 2000)}`)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "notion-sync", output: `Notion error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "notion-sync",
  description: "Creates, updates, and searches Notion pages and databases",
  keywords: [
    "add to notion", "notion page", "save to notion", "create notion",
    "notion database", "update notion", "find in notion", "notion notes",
    "notion task", "notion block", "save in notion",
  ],
}, handler);
