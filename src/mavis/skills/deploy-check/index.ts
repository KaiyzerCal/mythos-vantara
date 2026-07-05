// SKILL: deploy-check
// Checks deployment status and triggers deploys via mavis-deploy.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "deploy-check", output: "Check or trigger a deployment. Example: 'check deployment status' or 'deploy to production'" };
  }
  const action = /status|check|what.?s|how is/i.test(input) ? "status"
    : /deploy|push|release/i.test(input) ? "deploy"
    : "status";
  const env = /staging|preview/i.test(input) ? "staging"
    : /prod|production|live/i.test(input) ? "production"
    : "production";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-deploy", {
      body: { action, environment: env, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.status ?? data?.deployment ?? data?.result ?? data?.output;
    return { skillName: "deploy-check", output: result ? `🚀 **Deploy ${env}:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "deploy-check", output: `Deploy error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "deploy-check",
  description: "Checks deployment status and triggers production or staging deploys",
  keywords: [
    "deploy", "deployment status", "check deployment", "deploy to production",
    "release status", "is it deployed", "push to prod", "deploy staging",
    "deployment", "netlify deploy", "vercel deploy",
  ],
}, handler);
