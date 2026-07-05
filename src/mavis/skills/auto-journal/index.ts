// SKILL: auto-journal
// Auto-generates journal entries from your day's activity and context via mavis-auto-journal.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "auto-journal", output: "Auto-generate a journal entry. Example: 'auto journal today' or 'journal: worked on product launch, had investor call'" };
  }
  const notes = input.replace(/^(auto journal|journal|auto-journal)\s*:?\s*/i, "").trim() || "today's activity";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-auto-journal", {
      body: { notes, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.entry ?? data?.journal ?? data?.output;
    return { skillName: "auto-journal", output: result ? `📓 **Auto Journal:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "auto-journal", output: `Auto journal error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "auto-journal",
  description: "Auto-generates rich journal entries from daily activity, notes, and context",
  keywords: [
    "auto journal", "journal entry", "write journal", "auto-journal", "daily journal",
    "journal today", "generate journal", "journal my day", "journal note",
  ],
}, handler);
