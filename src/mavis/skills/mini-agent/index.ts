// SKILL: mini-agent
// Personal-use AI agent that routes to Google, Social, or General pipelines via mavis-mini-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "mini-agent", output: "Run a quick personal agent task. Example: 'mini agent: find me the best coffee shops in Austin' or 'agent: draft a quick reply to this email'" };
  }
  const task = input.replace(/^(mini agent|quick agent|personal agent|agent)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-mini-agent", {
      body: { task, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.result ?? data?.output;
    return { skillName: "mini-agent", output: result ? `⚡ **Mini Agent:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "mini-agent", output: `Mini agent error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "mini-agent",
  description: "Personal AI agent for quick tasks — searches Google, drafts social content, or handles general requests",
  keywords: [
    "mini agent", "quick agent", "personal agent", "fast agent", "agent task",
    "quick task", "do this for me", "handle this",
  ],
}, handler);
