// SKILL: so-curator
// Curates Stack Overflow answers and developer Q&A via mavis-so-curator.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "so-curator", output: "Search Stack Overflow. Example: 'stack overflow: how to debounce in React hooks' or 'SO: Python async await'" };
  }
  const query = input.replace(/^(stack overflow|so|so search|stackoverflow)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-so-curator", {
      body: { query, limit: 5 },
    });
    if (error) throw error;
    const result = data?.answers ?? data?.questions ?? data?.output;
    return { skillName: "so-curator", output: result ? `💡 **Stack Overflow:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "so-curator", output: `Stack Overflow error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "so-curator",
  description: "Curates top Stack Overflow answers for any programming question",
  keywords: [
    "stack overflow", "so search", "stackoverflow", "developer q&a", "programming answers",
    "how to code", "code question", "technical question", "so answer",
  ],
}, handler);
