// SKILL: user-model
// Synthesizes a behavioral model of the operator from recent data via mavis-user-model-refresh.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-user-model-refresh", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.model ?? data?.profile ?? data?.output;
    return { skillName: "user-model", output: result ? `👤 **User Model:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "user-model", output: `User model error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "user-model",
  description: "Refreshes the behavioral model from recent chat, goals, and tacit memory — injected into future responses",
  keywords: [
    "user model", "refresh my model", "update my profile", "behavioral model",
    "user profile refresh", "how do you see me", "my ai profile",
  ],
}, handler);
