// SKILL: letta-memory
// Persists long-term memories and retrieves context via mavis-letta (Letta/MemGPT).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "letta-memory", output: "Save or recall long-term memories. Example: 'remember that my favorite framework is Supabase' or 'what do you remember about my business goals?'" };
  }
  const isSearch = /what do you remember|recall|retrieve|what did i say|do you know|do you remember/i.test(input);
  const action = isSearch ? "recall" : "remember";
  const content = input.replace(/^(remember|save|store|memorize|add to memory)\s+(that\s+)?/i, "").replace(/^(what do you remember|recall|what did i say)\s+(about\s+)?/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-letta", {
      body: { action, content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.memories ?? data?.response ?? data?.output;
    return {
      skillName: "letta-memory",
      output: result
        ? (action === "remember" ? `🧠 **Saved to long-term memory:** "${content.slice(0, 100)}"` : `🧠 **From Memory:**\n\n${result}`)
        : JSON.stringify(data),
    };
  } catch (err) {
    return { skillName: "letta-memory", output: `Memory error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "letta-memory",
  description: "Saves and retrieves long-term memories across sessions using persistent AI memory",
  keywords: [
    "remember this", "save to memory", "memorize", "long term memory",
    "what do you remember", "recall", "memory", "don't forget",
    "store this", "keep this in mind", "add to memory",
  ],
}, handler);
