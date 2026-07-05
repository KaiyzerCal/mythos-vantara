// SKILL: design-system
// Generates design systems, component specs, and UI guidelines via mavis-design-system-gen.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "design-system", output: "Describe the product or brand and I'll generate a design system. Example: 'design system for a dark-mode fintech app called Nexus' or 'component spec for a button'" };
  }
  const isComponent = /component|button|card|modal|input|form/i.test(input);
  const type = isComponent ? "component" : "system";
  const description = input.replace(/^(design system|generate design system|create design system|component spec)\s+(for\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-design-system-gen", {
      body: { description, type, output_format: "structured" },
    });
    if (error) throw error;
    const result = data?.system ?? data?.component ?? data?.output ?? data?.spec;
    return { skillName: "design-system", output: result ? `🎨 **Design ${type === "component" ? "Component" : "System"}:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "design-system", output: `Design system error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "design-system",
  description: "Generates design systems, tokens, component specs, and UI guidelines",
  keywords: [
    "design system", "generate design system", "create design system",
    "component spec", "ui guidelines", "design tokens", "color palette",
    "typography system", "component library", "design language", "ui kit",
  ],
}, handler);
