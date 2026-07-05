// SKILL: email-triage
// Triages, sorts, and summarizes inbox via mavis-email-triage.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "email-triage", output: "I can triage your inbox, summarize unread emails, or flag what needs a reply. Try: 'triage my inbox' or 'what emails need a response?'" };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-email-triage", {
      body: { action: "triage", query: input.trim(), user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.summary ?? data?.triage ?? data?.result ?? data?.output;
    return { skillName: "email-triage", output: result ? `📧 **Inbox Triage:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "email-triage", output: `Email triage failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "email-triage",
  description: "Triages inbox, surfaces urgent emails, and flags what needs replies",
  keywords: [
    "triage my inbox", "check my emails", "what emails need response",
    "important emails", "email summary", "unread emails", "inbox zero",
    "sort my email", "email priority", "flagged emails", "urgent messages",
  ],
}, handler);
