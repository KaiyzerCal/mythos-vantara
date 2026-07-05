// SKILL: sheets-agent
// Reads, updates, and creates Google Sheets via mavis-sheets-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "sheets-agent", output: "Work with Google Sheets. Example: 'read my sales spreadsheet' or 'add a row to my tracker sheet'" };
  }
  const action = /add|append|write|update|insert/i.test(input) ? "append" : "read";
  const urlMatch = input.match(/https?:\/\/docs\.google\.com\/spreadsheets\/[^\s]+/);
  const sheetId = urlMatch?.[0]?.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-sheets-agent", {
      body: { action, spreadsheet_id: sheetId, query: input.trim(), user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.rows ?? data?.data ?? data?.result ?? data?.output;
    return { skillName: "sheets-agent", output: result ? `📊 **Sheets:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "sheets-agent", output: `Sheets error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "sheets-agent",
  description: "Reads and writes Google Sheets spreadsheets",
  keywords: [
    "google sheets", "spreadsheet", "update sheet", "read spreadsheet",
    "add to sheet", "google sheet data", "spreadsheet row", "sheets formula",
    "append to spreadsheet", "check my sheet",
  ],
}, handler);
