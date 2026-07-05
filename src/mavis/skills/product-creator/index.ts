// SKILL: product-creator
// Designs product specs, PRDs, and feature briefs via mavis-product-creator.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "product-creator", output: "Describe the product or feature and I'll build a full spec. Example: 'create a PRD for a mobile wallet feature' or 'product spec for AI writing assistant'" };
  }
  const isPRD = /prd|product requirement|spec doc/i.test(input);
  const product = input.replace(/^(create|build|write|generate)\s+(a\s+)?(prd|product spec|feature brief|product requirement document|spec)\s+(for|about)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-product-creator", {
      body: { product, type: isPRD ? "prd" : "spec", format: "structured" },
    });
    if (error) throw error;
    const result = data?.spec ?? data?.prd ?? data?.document ?? data?.output;
    return { skillName: "product-creator", output: result ? `📋 **Product Spec: ${product.slice(0, 60)}**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "product-creator", output: `Product creator error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "product-creator",
  description: "Creates product requirement documents, feature specs, and PRDs",
  keywords: [
    "product spec", "prd", "product requirement", "feature spec", "feature brief",
    "create a product", "product design doc", "write a prd", "product document",
    "user stories", "acceptance criteria", "product roadmap item",
  ],
}, handler);
