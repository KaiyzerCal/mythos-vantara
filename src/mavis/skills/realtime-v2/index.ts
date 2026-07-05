// SKILL: realtime-v2
// OpenAI Realtime API v2 session manager via mavis-realtime-v2.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const action = /stop|end|close/i.test(input ?? "") ? "stop" : "start";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-realtime-v2", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.session ?? data?.token ?? data?.output;
    return { skillName: "realtime-v2", output: result ? `⚡ **Realtime v2 Session:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 3000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "realtime-v2", output: `Realtime v2 error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "realtime-v2",
  description: "OpenAI Realtime API v2 session — ultra-low latency voice with function calling",
  keywords: [
    "realtime v2", "openai realtime", "realtime session", "low latency voice",
    "realtime api", "start realtime", "realtime voice session",
  ],
}, handler);
