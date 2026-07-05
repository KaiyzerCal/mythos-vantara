// SKILL: widget-gen
// Generates embeddable UI widgets and components via mavis-widget-gen.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "widget-gen", output: "Generate a UI widget. Example: 'widget: pricing table with 3 tiers' or 'create a countdown timer widget'" };
  }
  const description = input.replace(/^(widget gen|generate widget|create widget|widget|make widget)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-widget-gen", {
      body: { description },
    });
    if (error) throw error;
    const result = data?.widget ?? data?.html ?? data?.code ?? data?.output;
    return { skillName: "widget-gen", output: result ? `🧩 **Widget:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "widget-gen", output: `Widget gen error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "widget-gen",
  description: "Generates embeddable HTML/JS UI widgets — pricing tables, forms, countdown timers",
  keywords: [
    "widget gen", "generate widget", "create widget", "ui widget", "embed widget",
    "pricing table", "widget code", "html widget", "embeddable component",
  ],
}, handler);
