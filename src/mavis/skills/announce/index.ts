// SKILL: announce
// Sends a system-wide announcement to all channels via mavis-announce.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "announce", output: "Send an announcement. Example: 'announce: MAVIS is going down for maintenance at 3pm' or 'broadcast: new feature released — try the mindmap skill'" };
  }
  const message = input.replace(/^(announce|broadcast)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-announce", {
      body: { message, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.sent ?? data?.status ?? data?.output;
    return { skillName: "announce", output: result ? `📢 **Announcement Sent:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "announce", output: `Announce error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "announce",
  description: "Sends system-wide announcements across all connected channels — Slack, Discord, email",
  keywords: [
    "announce", "broadcast", "send announcement", "system announcement",
    "announce to all", "broadcast message", "system broadcast",
  ],
}, handler);
