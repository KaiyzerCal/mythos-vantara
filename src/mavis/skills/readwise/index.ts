// SKILL: readwise
// Imports and surfaces highlights from Readwise via mavis-readwise-import.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "readwise", output: "Sync or search Readwise highlights. Example: 'readwise highlights on productivity' or 'import my readwise'" };
  }
  const query = input.replace(/^(readwise|readwise highlights|my highlights)\s*(on\s+)?/i, "").trim() || null;
  const action = /import|sync/i.test(input) ? "sync" : "search";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-readwise-import", {
      body: { action, query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.highlights ?? data?.books ?? data?.output;
    return { skillName: "readwise", output: result ? `📖 **Readwise:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "readwise", output: `Readwise error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "readwise",
  description: "Imports and searches Readwise book highlights and reading notes",
  keywords: [
    "readwise", "readwise highlights", "book highlights", "import readwise",
    "sync readwise", "my reading highlights", "readwise notes", "book notes",
  ],
}, handler);
