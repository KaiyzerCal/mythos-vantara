// SKILL: notion-sync-raw
// Pulls Notion pages directly into MAVIS memories (skips unchanged pages) via mavis-notion-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-notion-sync", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.synced ?? data?.pages ?? data?.output;
    return { skillName: "notion-sync-raw", output: result ? `📝 **Notion Sync:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "notion-sync-raw", output: `Notion sync error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "notion-sync-raw",
  description: "Pulls Notion pages directly into MAVIS memory — incremental sync, skips unchanged pages",
  keywords: [
    "notion sync raw", "sync notion pages", "notion to memory", "notion raw sync",
    "pull from notion", "notion memory sync",
  ],
}, handler);
