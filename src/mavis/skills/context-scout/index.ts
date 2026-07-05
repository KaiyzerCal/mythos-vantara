// SKILL: context-scout
// Scouts context and background on any topic from saved data via mavis-context-scout.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "context-scout", output: "Scout context on a topic. Example: 'context on my upcoming investor meeting' or 'scout background on Stripe API'" };
  }
  const topic = input.replace(/^(context scout|scout context|background on|context on)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-context-scout", {
      body: { topic, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.context ?? data?.background ?? data?.output;
    return { skillName: "context-scout", output: result ? `🔎 **Context Scout:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "context-scout", output: `Context scout error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "context-scout",
  description: "Scouts and surfaces relevant context and background for any topic from your saved data",
  keywords: [
    "context scout", "scout context", "background check", "gather context",
    "prep context", "context for", "background on", "research context",
  ],
}, handler);
