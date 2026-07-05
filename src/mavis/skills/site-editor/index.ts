// SKILL: site-editor
// AI-powered live website editing — targeted edits, upgrades, widget injection via mavis-site-editor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "site-editor", output: "Edit a website with AI. Example: 'site edit https://mysite.com: update headline to be more benefit-focused' or 'inject pricing widget into my landing page'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
  const instructions = input.replace(/^(site edit|edit site|site editor|update site)\s*(https?:\/\/[^\s]+)?\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-site-editor", {
      body: { url, instructions, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.changes ?? data?.html ?? data?.output;
    return { skillName: "site-editor", output: result ? `🌐 **Site Edit:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "site-editor", output: `Site editor error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "site-editor",
  description: "AI-powered live website editing — targeted copy edits, design upgrades, widget injection",
  keywords: [
    "site editor", "edit website", "update website", "edit my site", "site edit",
    "website edit", "change website content", "update landing page", "edit html",
  ],
}, handler);
