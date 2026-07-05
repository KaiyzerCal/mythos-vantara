// SKILL: brand-identity
// Creates or applies brand voice, guidelines, and identity frameworks via mavis-brand-voice.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "brand-identity", output: "Tell me about your brand or what you need. Example: 'create brand guidelines for a fintech startup called Nexus' or 'define my brand voice as premium and bold'" };
  }
  const isApply = /apply|rewrite|make this sound|brand voice/i.test(input);
  const action = isApply ? "apply" : "create";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-brand-voice", {
      body: { action, content: input.trim(), user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.guidelines ?? data?.voice ?? data?.rewritten ?? data?.result ?? data?.output;
    return {
      skillName: "brand-identity",
      output: result ? `🎨 **Brand ${action === "apply" ? "Voice Applied" : "Guidelines"}:**\n\n${result}` : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "brand-identity", output: `Brand identity error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "brand-identity",
  description: "Creates brand guidelines, voice frameworks, and applies brand tone to content",
  keywords: [
    "brand guidelines", "brand voice", "brand identity", "create brand",
    "brand strategy", "brand tone", "brand personality", "branding for",
    "brand framework", "apply brand voice", "sound more like",
  ],
}, handler);
