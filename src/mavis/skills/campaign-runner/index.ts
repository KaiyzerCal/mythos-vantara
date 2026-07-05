// SKILL: campaign-runner
// Plans and executes multi-channel marketing campaigns via mavis-campaign-runner.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "campaign-runner", output: "Launch a marketing campaign. Example: 'run a product launch campaign for my SaaS' or 'create a 2-week content campaign about productivity'" };
  }
  const campaign = input.replace(/^(run|launch|create|plan|execute)\s+(a\s+)?(marketing\s+)?campaign\s+(for|about|on)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-campaign-runner", {
      body: { campaign, user_id: ctx.userId, channels: ["email", "social", "content"], duration_weeks: 2 },
    });
    if (error) throw error;
    const result = data?.campaign ?? data?.plan ?? data?.output;
    return { skillName: "campaign-runner", output: result ? `📣 **Campaign Plan:**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "campaign-runner", output: `Campaign runner error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "campaign-runner",
  description: "Plans and executes multi-channel marketing campaigns across email, social, and content",
  keywords: [
    "marketing campaign", "run campaign", "launch campaign", "campaign plan",
    "product launch campaign", "email campaign", "content campaign",
    "go-to-market", "campaign strategy", "promotional campaign",
  ],
}, handler);
