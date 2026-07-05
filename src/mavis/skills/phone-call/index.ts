// SKILL: phone-call
// Initiates AI phone calls via mavis-phone-call (Vapi/Twilio).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "phone-call", output: "Initiate an AI phone call. Example: 'call +15551234567 and remind them about the meeting tomorrow'" };
  }
  const phoneMatch = input.match(/\+?[\d\s\-().]{10,15}/);
  const phone = phoneMatch?.[0]?.replace(/[\s\-().]/g, "") ?? null;
  const task = phone ? input.replace(phoneMatch![0], "").replace(/^(and|to)\s+/i, "").trim() : input;
  if (!phone) return { skillName: "phone-call", output: "Please include a phone number to call." };
  try {
    const { data, error } = await supabase.functions.invoke("mavis-phone-call", {
      body: { to: phone, task, assistant_type: "outbound" },
    });
    if (error) throw error;
    const callId = data?.call_id ?? data?.id;
    return { skillName: "phone-call", output: callId ? `📞 Call initiated to ${phone}${callId ? ` (ID: ${callId})` : ""}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "phone-call", output: `Phone call error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "phone-call",
  description: "Makes AI-powered phone calls to any number with a specific task or message",
  keywords: [
    "call", "make a phone call", "phone call to", "call someone",
    "dial", "call and tell them", "place a call", "automated call",
    "ai phone call", "call to confirm", "call to remind",
  ],
}, handler);
