// SKILL: memory-consolidate
// Compresses old memories into dense summaries to keep context lean via mavis-memory-consolidate.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-memory-consolidate", {
      body: { user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.consolidated ?? data?.status ?? data?.output;
    return { skillName: "memory-consolidate", output: result ? `🗜️ **Memory Consolidated:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "memory-consolidate", output: `Memory consolidate error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "memory-consolidate",
  description: "Compresses memories older than 14 days into dense summaries to keep context efficient",
  keywords: [
    "memory consolidate", "compress memories", "clean memory", "consolidate memory",
    "memory cleanup", "archive memories", "memory maintenance",
  ],
}, handler);
