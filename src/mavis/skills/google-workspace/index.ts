// SKILL: google-workspace
// Interacts with Google Workspace — Docs, Sheets, Drive, Calendar via mavis-google-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "google-workspace", output: "Use Google Workspace. Example: 'google docs create: meeting agenda' or 'google sheets: create budget tracker'" };
  }
  const action = input.replace(/^(google workspace|google agent|google docs|google sheets|google drive)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-google-agent", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.result ?? data?.url ?? data?.output;
    return { skillName: "google-workspace", output: result ? `🔵 **Google Workspace:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "google-workspace", output: `Google Workspace error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "google-workspace",
  description: "Interacts with Google Workspace — creates Docs, manages Sheets, accesses Drive and Calendar",
  keywords: [
    "google workspace", "google docs", "google sheets", "google drive",
    "google agent", "create google doc", "google calendar", "workspace",
    "gdocs", "gsheets", "gdrive",
  ],
}, handler);
