// SKILL: sms-send
// Sends SMS text messages via mavis-sms (Twilio).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "sms-send", output: "Send an SMS. Example: 'text +15551234567: I'll be 10 minutes late'" };
  }
  const phoneMatch = input.match(/\+?[\d\s\-().]{10,15}/);
  const phone = phoneMatch?.[0]?.replace(/[\s\-().]/g, "") ?? null;
  const message = phone ? input.replace(phoneMatch![0], "").replace(/^[:,\s]+/, "").replace(/^(text|sms|send)\s+/i, "").trim() : input.replace(/^(text|sms|send)\s+/i, "").trim();
  if (!phone) return { skillName: "sms-send", output: "Please include a phone number. Example: 'text +15551234567: your message here'" };
  try {
    const { data, error } = await supabase.functions.invoke("mavis-sms", {
      body: { to: phone, message },
    });
    if (error) throw error;
    const success = data?.success ?? data?.sid ?? !data?.error;
    return { skillName: "sms-send", output: success ? `📱 SMS sent to ${phone}: "${message.slice(0, 100)}"` : `SMS failed: ${data?.error ?? JSON.stringify(data)}` };
  } catch (err) {
    return { skillName: "sms-send", output: `SMS error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "sms-send",
  description: "Sends SMS text messages to any phone number via Twilio",
  keywords: [
    "send sms", "text message", "send a text", "text someone",
    "sms to", "message to phone", "send text to", "text +1",
  ],
}, handler);
