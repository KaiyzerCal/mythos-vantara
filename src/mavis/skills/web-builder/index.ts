// SKILL: web-builder
// Builds and updates web pages via mavis-web-builder / mavis-site-editor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "web-builder", output: "Build or edit a web page. Example: 'build a landing page for my SaaS startup' or 'create an HTML pricing page with 3 tiers'" };
  }
  const isEdit = /edit|update|change|modify|fix/i.test(input);
  const description = input.replace(/^(build|create|make|generate|design)\s+(a\s+)?(landing page|webpage|website|html page|web page)\s+(for\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-web-builder", {
      body: { action: isEdit ? "edit" : "build", description, output_format: "html" },
    });
    if (error) throw error;
    const html = data?.html ?? data?.code ?? data?.output;
    const url = data?.url ?? data?.preview_url;
    return {
      skillName: "web-builder",
      output: url
        ? `🌐 **Page Built:** [Preview](${url})\n\n${html ? `\`\`\`html\n${String(html).slice(0, 2000)}\n\`\`\`` : ""}`
        : (html ? `🌐 **Generated HTML:**\n\`\`\`html\n${String(html).slice(0, 4000)}\n\`\`\`` : JSON.stringify(data)),
    };
  } catch (err) {
    return { skillName: "web-builder", output: `Web builder error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "web-builder",
  description: "Builds and edits web pages and landing pages with AI-generated HTML/CSS",
  keywords: [
    "build a landing page", "create a webpage", "build website", "landing page",
    "html page", "make a website", "generate web page", "site editor",
    "build a page", "create landing", "build homepage",
  ],
}, handler);
