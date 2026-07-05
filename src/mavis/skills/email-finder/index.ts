// SKILL: email-finder
// Finds professional email addresses by domain and name via Apify clearpath/email-finder-api.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "email-finder", output: "Find email addresses. Example: 'find email for John Doe at acme.com' or 'email finder: domain=example.com name=Jane Smith'" };
  }
  const domain = input.match(/(?:at\s+|domain=)([\w-]+\.\w{2,})/i)?.[1] ?? input.match(/[\w-]+\.\w{2,}/)?.[0] ?? "";
  const name = input.replace(/^(find email for|email finder|find email)\s*/i, "").replace(/\s*(at|domain=)\s*[\w.-]+/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "clearpath/email-finder-api", input: { domain, name }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.email ?? data;
    return { skillName: "email-finder", output: result ? `📧 **Email Found:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "email-finder", output: `Email finder error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "email-finder",
  description: "Finds professional email addresses by company domain and person name",
  keywords: [
    "email finder", "find email", "find email address", "email lookup",
    "find contact email", "email search", "professional email finder",
  ],
}, handler);
