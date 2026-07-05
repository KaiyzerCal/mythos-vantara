// SKILL: flowise
// Proxies queries to self-hosted Flowise AI flows and chatflows via mavis-flowise.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "flowise", output: "Run a Flowise flow. Example: 'flowise: run my customer support flow with: [user message]' or 'flowise agent: [query]'" };
  }
  const query = input.replace(/^(flowise|flowise agent|run flowise|flowise flow)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-flowise", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.response ?? data?.output ?? data?.result;
    return { skillName: "flowise", output: result ? `🌊 **Flowise:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "flowise", output: `Flowise error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "flowise",
  description: "Proxies queries to self-hosted Flowise AI chatflows and agent flows",
  keywords: [
    "flowise", "flowise agent", "run flowise", "flowise flow", "no-code ai flow",
    "flowise chatflow", "flowise chain",
  ],
}, handler);
