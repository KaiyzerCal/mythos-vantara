// SKILL: whatsapp-cloud
// WhatsApp Cloud API messaging via Apify MCP server mdbm/whatsapp-cloud-api-mcp.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "whatsapp-cloud", output: "Send WhatsApp via Cloud API. Example: 'whatsapp cloud send +15551234567: Hello!' or 'wa cloud message: +1555...: your text here'" };
  }
  const phoneMatch = input.match(/\+?\d[\d\s\-]{7,}/);
  const phone = phoneMatch?.[0]?.replace(/\s|-/g, "") ?? "";
  const message = input.replace(/^(whatsapp cloud send|wa cloud message|whatsapp cloud)\s*/i, "").replace(phone, "").replace(/^\s*:?\s*/, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "mdbm/whatsapp-cloud-api-mcp", input: { phone, message, user_id: ctx.userId }, timeout: 30 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.sent ?? data;
    return { skillName: "whatsapp-cloud", output: result ? `💬 **WhatsApp Cloud:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "whatsapp-cloud", output: `WhatsApp Cloud error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "whatsapp-cloud",
  description: "WhatsApp Cloud API messaging — send messages and templates via official WhatsApp API",
  keywords: [
    "whatsapp cloud", "wa cloud api", "whatsapp cloud api", "whatsapp business api",
    "send whatsapp cloud", "whatsapp official api", "wa cloud send",
  ],
}, handler);
