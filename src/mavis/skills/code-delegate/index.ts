// SKILL: code-delegate
// Delegates coding sessions to Devin AI or Cursor Composer via mavis-code-delegate.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "code-delegate", output: "Delegate coding to Devin AI. Example: 'delegate to devin: add user authentication to my Next.js app' or 'code delegate: fix all TypeScript errors in my repo'" };
  }
  const task = input.replace(/^(delegate to devin|code delegate|devin|delegate coding)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-code-delegate", {
      body: { task, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.session ?? data?.status ?? data?.output;
    return { skillName: "code-delegate", output: result ? `🤖 **Code Delegated:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "code-delegate", output: `Code delegate error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "code-delegate",
  description: "Delegates complex coding tasks to Devin AI or Cursor Composer and manages sessions",
  keywords: [
    "delegate to devin", "devin ai", "code delegate", "devin code", "cursor composer",
    "delegate coding", "send to devin", "ai coding assistant",
  ],
}, handler);
