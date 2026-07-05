// SKILL: daily-notes
// Writes and retrieves daily journal entries in the vantara.exe app via mavis-daily-notes.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "daily-notes", output: "Write to your daily notes or read recent entries. Example: 'add to daily notes: had a breakthrough on the UI today' or 'show my notes from this week'" };
  }
  const isRead = /show|read|get|recent|today.?s notes|my notes|what did i write/i.test(input);
  const entry = input.replace(/^(add to daily notes|write to notes|journal entry|note)\s*:?\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-daily-notes", {
      body: {
        action: isRead ? "read" : "write",
        content: isRead ? undefined : entry,
        user_id: ctx.userId,
        date: new Date().toISOString().split("T")[0],
      },
    });
    if (error) throw error;
    const result = data?.entries ?? data?.note ?? data?.result ?? data?.output;
    return {
      skillName: "daily-notes",
      output: result
        ? (isRead
            ? `📓 **Daily Notes:**\n\n${Array.isArray(result) ? result.slice(0, 5).map((n: any) => `**${n.date ?? ""}:** ${n.content ?? n.text ?? ""}`.trim()).join("\n\n") : String(result)}`
            : `📓 Noted: "${entry.slice(0, 100)}"`)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "daily-notes", output: `Daily notes error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "daily-notes",
  description: "Writes and retrieves daily journal entries in VANTARA",
  keywords: [
    "daily notes", "add to notes", "journal entry", "write to journal",
    "note this", "my notes today", "show my notes", "recent notes",
    "log this", "jot this down", "today's notes", "write this down",
  ],
}, handler);
