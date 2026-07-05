// SKILL: hire-specialist
// Creates a new AI specialist agent definition for the CODEXOS team via mavis-chat.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "hire-specialist", output: "Hire a new AI specialist. Example: 'hire specialist: I need a crypto trading analyst who monitors DeFi protocols' or 'hire: podcast editor for audio cleanup'" };
  }
  const role = input.replace(/^(hire specialist|hire|i need)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: role }],
        systemPrompt: "You are the CODEXOS HR agent. Design a new AI specialist agent for the team. Output: 1) Role name and title, 2) Core competencies (5 bullets), 3) Keywords that route work to them, 4) System prompt they operate under, 5) Example tasks they handle. Make it precise and actionable for MAVIS to deploy.",
        mode: "PRIME",
        chatKind: "skill",
        user_id: ctx.userId,
      },
    });
    if (error) throw error;
    const result = data?.message ?? data?.output ?? data?.content;
    return { skillName: "hire-specialist", output: result ? `👤 **New Specialist Design:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "hire-specialist", output: `Hire specialist error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "hire-specialist",
  description: "Designs a new AI specialist for the CODEXOS team — role, competencies, system prompt",
  keywords: [
    "hire specialist", "new specialist", "add agent", "hire agent",
    "create specialist", "new ai role", "design agent role",
  ],
}, handler);
