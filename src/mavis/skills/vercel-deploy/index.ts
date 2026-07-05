// SKILL: vercel-deploy
// Deploys projects and manages Vercel via mavis-vercel-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "vercel-deploy", output: "Deploy or manage Vercel. Example: 'vercel deploy my-project' or 'show vercel deployments'" };
  }
  const action = input.replace(/^(vercel|vercel deploy|deploy to vercel)\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-vercel-agent", {
      body: { action, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.deploy ?? data?.status ?? data?.url ?? data?.output;
    return { skillName: "vercel-deploy", output: result ? `▲ **Vercel:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "vercel-deploy", output: `Vercel error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "vercel-deploy",
  description: "Deploys projects and manages Vercel deployments, domains, and environment variables",
  keywords: [
    "vercel", "vercel deploy", "deploy to vercel", "vercel project",
    "vercel deployment", "vercel status", "vercel build",
  ],
}, handler);
