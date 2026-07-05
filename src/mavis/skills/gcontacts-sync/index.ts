// SKILL: gcontacts-sync
// Syncs and searches Google Contacts via mavis-gcontacts-sync.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "gcontacts-sync", output: "Sync or search Google Contacts. Example: 'google contacts sync' or 'find contact: John Smith'" };
  }
  const action = /sync|refresh/i.test(input) ? "sync" : "search";
  const query = input.replace(/^(google contacts|gcontacts|contacts sync|find contact)\s*:?\s*/i, "").trim() || "";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-gcontacts-sync", {
      body: { action, query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.contacts ?? data?.status ?? data?.output;
    return { skillName: "gcontacts-sync", output: result ? `👥 **Google Contacts:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "gcontacts-sync", output: `Contacts sync error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "gcontacts-sync",
  description: "Syncs and searches Google Contacts",
  keywords: [
    "google contacts", "gcontacts", "contacts sync", "sync contacts", "find contact",
    "search contacts", "contact list", "google contacts sync",
  ],
}, handler);
