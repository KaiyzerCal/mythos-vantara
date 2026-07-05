// SKILL: telegram-send
// Sends Telegram messages via mavis-telegram-bot.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "telegram-send", output: "Send a Telegram message. Example: 'send telegram: Meeting at 3pm tomorrow' or 'telegram [chat_id]: your message'" };
  }
  const chatMatch = input.match(/telegram\s+([-\d]+):\s*/i);
  const chatId = chatMatch?.[1] ?? null;
  const message = input.replace(/^(send\s+)?(telegram|tg)\s+([-\d]+:\s*)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-telegram-bot", {
      body: { action: "send_message", chat_id: chatId, text: message },
    });
    if (error) throw error;
    const success = data?.ok ?? data?.success ?? !data?.error;
    return { skillName: "telegram-send", output: success ? `✉️ Telegram message sent: "${message.slice(0, 100)}"` : `Failed: ${data?.description ?? JSON.stringify(data)}` };
  } catch (err) {
    return { skillName: "telegram-send", output: `Telegram error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "telegram-send",
  description: "Sends messages via Telegram bot",
  keywords: [
    "send telegram", "telegram message", "telegram notification",
    "message via telegram", "telegram me", "send via telegram",
    "notify telegram", "push to telegram",
  ],
}, handler);
