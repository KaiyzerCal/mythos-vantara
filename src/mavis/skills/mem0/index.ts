// SKILL: mem0
// Stores and retrieves persistent memories using the Mem0 memory system via mavis-mem0.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "mem0", output: "Store or recall memories. Example: 'remember: my investor is Sarah Chen from Sequoia' or 'recall what I know about fundraising'" };
  }
  const isStore = /remember|store|save|note that/i.test(input);
  const content = input.replace(/^(mem0|remember|store memory|recall|mem zero)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-mem0", {
      body: { action: isStore ? "add" : "search", content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.memories ?? data?.results ?? data?.status ?? data?.output;
    return { skillName: "mem0", output: result ? `🧠 **Memory:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "mem0", output: `Mem0 error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "mem0",
  description: "Persistent AI memory — stores and retrieves facts, preferences, and context via Mem0",
  keywords: [
    "mem0", "remember this", "store memory", "recall", "memory", "note that",
    "don't forget", "save this fact", "mem zero", "persistent memory",
  ],
}, handler);
