// SKILL: pdf-gen
// Generates polished PDF documents from content or templates via mavis-pdf-gen.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "pdf-gen", output: "Generate a PDF. Example: 'pdf: create a one-page proposal for [project]' or 'generate pdf invoice for $5000'" };
  }
  const content = input.replace(/^(pdf gen|generate pdf|pdf|create pdf|make pdf)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-pdf-gen", {
      body: { content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.pdf_url ?? data?.url ?? data?.output;
    return { skillName: "pdf-gen", output: result ? `📄 **PDF Generated:**\n\n${typeof result === "string" ? (result.startsWith("http") ? `[Download PDF](${result})` : result) : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "pdf-gen", output: `PDF gen error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "pdf-gen",
  description: "Generates polished PDF documents — proposals, invoices, reports, one-pagers",
  keywords: [
    "pdf gen", "generate pdf", "create pdf", "make pdf", "pdf document",
    "pdf report", "pdf invoice", "export pdf", "pdf proposal",
  ],
}, handler);
