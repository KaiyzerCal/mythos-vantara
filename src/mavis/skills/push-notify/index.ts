// SKILL: push-notify
// Sends push notifications to iOS/Android/web devices via mavis-push-notify.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "push-notify", output: "Send a push notification. Example: 'push notify: Your daily brief is ready!' or 'notify my phone: meeting in 15 minutes'" };
  }
  const message = input.replace(/^(push notify|notify my phone|push notification|send push)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-push-notify", {
      body: { message, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.sent ?? data?.status ?? data?.output;
    return { skillName: "push-notify", output: result ? `📲 **Push Sent:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "push-notify", output: `Push notify error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "push-notify",
  description: "Sends iOS/Android/web push notifications to your registered devices",
  keywords: [
    "push notify", "push notification", "notify my phone", "send push",
    "push alert", "phone notification", "device notification",
  ],
}, handler);
