// SKILL: email-draft
// Pattern from 500-AI-Agents #05 — email drafting agent.
// Calls mavis-email-send in draft mode; falls back to direct LLM if not available.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "email-draft", output: "Describe who you're writing to and what the email should say — I'll draft it." };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-email-send", {
      body: { instruction: input.trim(), mode: "draft" },
    });
    if (error) throw error;
    return { skillName: "email-draft", output: data?.draft ?? data?.content ?? data?.output ?? JSON.stringify(data) };
  } catch {
    const { data, error: chatErr } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: input }],
        systemPrompt: "You are an expert email writer. Draft professional, clear, and effective emails based on the user's instructions. Output the email subject on the first line prefixed with 'Subject:', then a blank line, then the email body. Match the appropriate tone (formal/casual) to the context.",
        mode: "PRIME",
        chatKind: "skill",
      },
    });
    if (chatErr) throw chatErr;
    return { skillName: "email-draft", output: data?.content ?? "[No output]" };
  }
};

registerSkill({
  name: "email-draft",
  description: "Drafts professional emails — compose, reply, follow-up, outreach, or any email context",
  keywords: [
    "draft an email", "write an email", "email to", "compose email", "email draft",
    "follow up email", "reply to", "write a follow-up", "outreach email",
    "cold email", "email template", "write me an email",
  ],
}, handler);
