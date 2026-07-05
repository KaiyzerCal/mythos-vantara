// SKILL: whatsapp-send
// Sends SMS and WhatsApp messages via Twilio, including bulk send via mavis-twilio-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "whatsapp-send", output: "Send WhatsApp or SMS via Twilio. Example: 'whatsapp: +1234567890 Hey, checking in!' or 'sms via twilio: +1234567890 [message]'" };
  }
  const channel = /whatsapp/i.test(input) ? "whatsapp" : "sms";
  const phone = input.match(/\+?\d[\d\s\-().]{8,}/)?.[0]?.replace(/\s/g, "") ?? null;
  const message = input.replace(/^(whatsapp|sms via twilio|twilio sms|twilio whatsapp)\s*:?\s*/i, "").replace(/\+?\d[\d\s\-().]{8,}/, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-twilio-agent", {
      body: { channel, to: phone, message, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.sent ?? data?.status ?? data?.output;
    return { skillName: "whatsapp-send", output: result ? `📱 **${channel === "whatsapp" ? "WhatsApp" : "SMS"} Sent:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "whatsapp-send", output: `WhatsApp/SMS error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "whatsapp-send",
  description: "Sends WhatsApp and SMS messages via Twilio — single messages, bulk send, delivery status",
  keywords: [
    "whatsapp send", "send whatsapp", "whatsapp message", "sms via twilio",
    "twilio sms", "twilio whatsapp", "send via twilio", "bulk sms",
  ],
}, handler);
