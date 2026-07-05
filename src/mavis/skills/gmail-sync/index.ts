// SKILL: gmail-sync
// Syncs Gmail inbox, searches emails, and manages labels via mavis-gmail-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "gmail-sync", output: "Sync or search Gmail. Example: 'gmail sync' or 'gmail search: investor emails this week'" };
  }
  const action = /sync|refresh/i.test(input) ? "sync" : "search";
  const query = input.replace(/^(gmail sync|gmail search|gmail|sync gmail|search gmail)\s*:?\s*/i, "").trim() || "";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-gmail-sync", {
      body: { action, query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.emails ?? data?.threads ?? data?.status ?? data?.output;
    return { skillName: "gmail-sync", output: result ? `📧 **Gmail:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "gmail-sync", output: `Gmail sync error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "gmail-sync",
  description: "Syncs Gmail inbox and searches emails",
  keywords: [
    "gmail sync", "sync gmail", "gmail search", "search gmail", "gmail inbox",
    "check gmail", "gmail emails", "refresh gmail",
  ],
}, handler);
