// SKILL: netlify-deploy
// Deploys sites and manages Netlify projects via mavis-netlify.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "netlify-deploy", output: "Deploy or manage Netlify. Example: 'netlify deploy my-site' or 'show netlify deployments'" };
  }
  const action = input.replace(/^(netlify|netlify deploy|deploy to netlify)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-netlify", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.deploy ?? data?.status ?? data?.url ?? data?.output;
    return { skillName: "netlify-deploy", output: result ? `🟢 **Netlify:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "netlify-deploy", output: `Netlify error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "netlify-deploy",
  description: "Deploys sites and manages Netlify projects, deployments, and settings",
  keywords: [
    "netlify", "netlify deploy", "deploy to netlify", "netlify site",
    "netlify deployment", "netlify status", "netlify build",
  ],
}, handler);
