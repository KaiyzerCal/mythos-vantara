// SKILL: chain-builder
// Builds and runs multi-step AI chains via mavis-chain-builder.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "chain-builder", output: "Build an AI chain. Example: 'build chain: research → summarize → draft email' or 'create workflow: analyze data → generate report → send slack'" };
  }
  const chainSpec = input.replace(/^(build chain|create chain|chain builder)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chain-builder", {
      body: { chain_spec: chainSpec, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.chain ?? data?.result ?? data?.output;
    return { skillName: "chain-builder", output: result ? `🔗 **Chain Builder:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "chain-builder", output: `Chain builder error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "chain-builder",
  description: "Builds and runs multi-step AI chains — connect research, analysis, drafting, and dispatch",
  keywords: [
    "build chain", "chain builder", "create chain", "multi-step workflow",
    "ai chain", "chain steps", "workflow chain",
  ],
}, handler);
