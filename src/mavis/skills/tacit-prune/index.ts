// SKILL: tacit-prune
// Prunes tacit memory: age cap, category cap, AI dedup via mavis-tacit-prune.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-tacit-prune", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.pruned ?? data?.status ?? data?.output;
    return { skillName: "tacit-prune", output: result ? `✂️ **Tacit Pruned:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "tacit-prune", output: `Tacit prune error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "tacit-prune",
  description: "Prunes tacit memory — 90-day age cap, 60-entry category cap, AI deduplication",
  keywords: [
    "tacit prune", "prune tacit memory", "clean tacit memory", "memory prune",
    "optimize memory", "reduce memory", "memory maintenance",
  ],
}, handler);
