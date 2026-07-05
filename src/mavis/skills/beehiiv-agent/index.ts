// SKILL: beehiiv-agent
// Publishes newsletter issues and checks subscriber stats via mavis-beehiiv-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "beehiiv-agent", output: "Manage your Beehiiv newsletter. Example: 'write newsletter issue about AI trends' or 'show my beehiiv subscriber stats'" };
  }
  const isStats = /stats|subscribers|open rate|analytics|growth/i.test(input);
  const action = isStats ? "stats" : "draft";
  const topic = input.replace(/^(write|draft|create|send)\s+(a\s+)?(newsletter|beehiiv|issue)\s+(about|on|covering)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-beehiiv-agent", {
      body: { action, topic: action === "draft" ? topic : undefined, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.draft ?? data?.post ?? data?.stats ?? data?.output;
    return {
      skillName: "beehiiv-agent",
      output: result
        ? (isStats ? `📊 **Beehiiv Stats:**\n\n${JSON.stringify(result, null, 2).slice(0, 1500)}` : `📧 **Newsletter Draft:**\n\n${result}`)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "beehiiv-agent", output: `Beehiiv error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "beehiiv-agent",
  description: "Writes newsletter issues and checks Beehiiv subscriber analytics",
  keywords: [
    "beehiiv", "newsletter", "newsletter issue", "write newsletter",
    "subscriber stats", "email newsletter", "newsletter draft",
    "beehiiv stats", "newsletter analytics", "publish newsletter",
  ],
}, handler);
