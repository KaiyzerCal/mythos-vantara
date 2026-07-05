// SKILL: notes-import
// Imports notes from external sources (Notion, Obsidian, Bear, plain text) via mavis-import.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "notes-import", output: "Import notes into MAVIS. Example: 'import notes from notion' or 'import my obsidian vault' or 'import notes: [paste text]'" };
  }
  const source = /notion/i.test(input) ? "notion" : /obsidian/i.test(input) ? "obsidian" : /bear/i.test(input) ? "bear" : "text";
  const content = input.replace(/^(import notes|import)\s*(from\s+)?(notion|obsidian|bear)?\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-import", {
      body: { source, content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.imported ?? data?.notes ?? data?.output;
    return { skillName: "notes-import", output: result ? `📥 **Notes Import:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "notes-import", output: `Notes import error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "notes-import",
  description: "Imports notes from Notion, Obsidian, Bear, or plain text into MAVIS memory",
  keywords: [
    "import notes", "notes import", "import obsidian", "import notion notes",
    "import bear notes", "bulk import", "import my notes",
  ],
}, handler);
