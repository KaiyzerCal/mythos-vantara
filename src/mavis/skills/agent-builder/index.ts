// SKILL: agent-builder
// Generates custom AI agent configs from a business brief via mavis-agent-builder.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "agent-builder", output: "Build a custom AI agent. Example: 'build agent: customer support bot for my e-commerce store' or 'create agent: sales qualifier for SaaS'" };
  }
  const brief = input.replace(/^(build agent|create agent|agent builder|new agent)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-agent-builder", {
      body: { brief, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.agent_config ?? data?.agent ?? data?.output;
    return { skillName: "agent-builder", output: result ? `🤖 **Agent Built:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "agent-builder", output: `Agent builder error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "agent-builder",
  description: "Generates complete custom AI agent configurations from a plain business brief",
  keywords: [
    "build agent", "create agent", "agent builder", "new agent", "custom agent",
    "design agent", "agent config", "build a bot", "create a bot",
  ],
}, handler);
