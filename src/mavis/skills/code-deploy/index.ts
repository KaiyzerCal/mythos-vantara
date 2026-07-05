// SKILL: code-deploy
// Deploys code to production environments via mavis-code-deploy.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "code-deploy", output: "Deploy code. Example: 'deploy to production' or 'code deploy: my-app staging branch main'" };
  }
  const deployTarget = input.replace(/^(code deploy|deploy|deploy to)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-code-deploy", {
      body: { target: deployTarget, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.deploy ?? data?.status ?? data?.url ?? data?.output;
    return { skillName: "code-deploy", output: result ? `🚀 **Code Deploy:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "code-deploy", output: `Code deploy error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "code-deploy",
  description: "Deploys code to staging or production environments and reports deployment status",
  keywords: [
    "code deploy", "deploy code", "deploy to production", "deploy to staging",
    "push to production", "release code", "deployment", "ship code",
  ],
}, handler);
