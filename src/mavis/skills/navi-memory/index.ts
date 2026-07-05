// SKILL: navi-memory
// Consolidates and syncs NAVI memory with MAVIS via navi-memory-consolidator.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("navi-memory-consolidator", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.memories ?? data?.consolidated ?? data?.output;
    return { skillName: "navi-memory", output: result ? `🧠 **NAVI Memory Sync:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "navi-memory", output: `NAVI memory error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "navi-memory",
  description: "Consolidates NAVI memory — syncs NAVI's learned context with MAVIS memory store",
  keywords: [
    "navi memory", "sync navi memory", "navi memory consolidate",
    "consolidate navi", "navi knowledge sync", "navi memory sync",
  ],
}, handler);
