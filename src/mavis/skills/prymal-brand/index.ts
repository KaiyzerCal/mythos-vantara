// SKILL: prymal-brand
// Generates Prymal-branded content — copy, captions, emails via prymal-brand-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "prymal-brand", output: "Generate Prymal brand content. Example: 'prymal brand: write instagram caption for new coffee launch' or 'prymal copy: email for promo'" };
  }
  const brief = input.replace(/^(prymal brand|prymal copy|prymal content)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("prymal-brand-agent", {
      body: { brief, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.content ?? data?.copy ?? data?.output;
    return { skillName: "prymal-brand", output: result ? `☕ **Prymal Brand Content:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "prymal-brand", output: `Prymal brand error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "prymal-brand",
  description: "Generates Prymal-branded content — captions, emails, ad copy in Prymal voice",
  keywords: [
    "prymal brand", "prymal copy", "prymal content", "write prymal",
    "prymal caption", "prymal email", "prymal marketing",
  ],
}, handler);
