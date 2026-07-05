// SKILL: archivist
// Archives and organizes knowledge — prunes by age/importance, AI dedup via mavis-archivist.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-archivist", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.archived ?? data?.status ?? data?.output;
    return { skillName: "archivist", output: result ? `📦 **Archivist:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "archivist", output: `Archivist error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "archivist",
  description: "Archives and organizes knowledge — age pruning, importance ranking, AI deduplication",
  keywords: [
    "archivist", "archive knowledge", "clean up knowledge", "organize memories",
    "prune memories", "knowledge archive", "archive old data",
  ],
}, handler);
