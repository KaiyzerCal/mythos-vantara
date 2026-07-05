// SKILL: memory-agent
// Long-term memory toolkit: save, retrieve, and deliver memories via mavis-memory-agent.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "memory-agent", output: "Manage long-term memory. Example: 'memory save: I prefer bullet points in all reports' or 'memory retrieve: what do I know about fundraising?'" };
  }
  const isSave = /save|store|remember|add memory/i.test(input);
  const content = input.replace(/^(memory save|memory store|memory retrieve|memory search|save memory|memory agent)\s*:?\s*/i, "").trim() || input;
  const action = isSave ? "save" : "retrieve";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-memory-agent", {
      body: { action, content, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.memories ?? data?.saved ?? data?.output;
    return { skillName: "memory-agent", output: result ? `🧠 **Memory Agent:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "memory-agent", output: `Memory agent error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "memory-agent",
  description: "Long-term memory toolkit — save facts, retrieve memories, deliver to Telegram or Gmail",
  keywords: [
    "memory agent", "memory save", "memory retrieve", "save memory", "store memory",
    "long term memory", "add to memory", "memory toolkit",
  ],
}, handler);
