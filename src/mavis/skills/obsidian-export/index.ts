// SKILL: obsidian-export
// Exports notes and knowledge to Obsidian vault format via mavis-obsidian-export.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "obsidian-export", output: "Export to Obsidian. Example: 'export to obsidian' or 'obsidian export my notes this week'" };
  }
  const query = input.replace(/^(obsidian export|export to obsidian|export obsidian|obsidian)\s*/i, "").trim() || "all recent";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-obsidian-export", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.export ?? data?.files ?? data?.url ?? data?.output;
    return { skillName: "obsidian-export", output: result ? `🗒️ **Obsidian Export:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "obsidian-export", output: `Obsidian export error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "obsidian-export",
  description: "Exports notes and knowledge to Obsidian-compatible markdown vault format",
  keywords: [
    "obsidian export", "export to obsidian", "obsidian vault", "obsidian notes",
    "export notes obsidian", "obsidian markdown", "send to obsidian",
  ],
}, handler);
