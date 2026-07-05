// SKILL: security-scan
// Website security audit: HTTP headers + HTML → parallel Claude analysis → A+–F grade via mavis-security-scanner.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "security-scan", output: "Scan website security. Example: 'security scan https://mysite.com' or 'audit security of my site'" };
  }
  const url = input.match(/https?:\/\/[^\s]+/)?.[0] ?? input.replace(/^(security scan|scan security|security audit|audit security)\s*(of\s+)?(my\s+)?(site\s+)?/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-security-scanner", {
      body: { url, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.report ?? data?.grade ?? data?.output;
    return { skillName: "security-scan", output: result ? `🔒 **Security Scan:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "security-scan", output: `Security scan error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "security-scan",
  description: "Website security audit — HTTP headers, HTML analysis, A+–F grade, optional Gmail report",
  keywords: [
    "security scan", "security audit", "website security", "scan my site",
    "check security", "ssl check", "security grade", "vulnerability scan",
  ],
}, handler);
