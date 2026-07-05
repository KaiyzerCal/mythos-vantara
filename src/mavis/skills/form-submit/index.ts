// SKILL: form-submit
// Fills and submits web forms automatically via mavis-form-submit.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "form-submit", output: "Submit a web form. Example: 'form submit: fill out contact form at https://site.com/contact with my info'" };
  }
  const task = input.replace(/^(form submit|submit form|fill form|fill out form)\s*:?\s*/i, "").trim() || input;
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-form-submit", {
      body: { task, url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.status ?? data?.result ?? data?.output;
    return { skillName: "form-submit", output: result ? `📝 **Form Submit:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "form-submit", output: `Form submit error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "form-submit",
  description: "Automatically fills and submits web forms on any website",
  keywords: [
    "form submit", "fill form", "submit form", "fill out form", "web form",
    "auto-fill", "form automation", "submit application",
  ],
}, handler);
