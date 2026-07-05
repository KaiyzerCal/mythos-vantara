// SKILL: council-session
// Runs a multi-AI-perspective council debate on any question via mavis-council-session.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "council-session", output: "Bring a hard question to the council — multiple AI perspectives debate and synthesize a final answer. Example: 'council: should I build or buy this feature?'" };
  }
  const question = input.replace(/^(council|run council|council session|get council opinion on)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-council-session", {
      body: { question, user_id: ctx.userId, perspectives: ["skeptic", "advocate", "realist", "visionary"] },
    });
    if (error) throw error;
    const synthesis = data?.synthesis ?? data?.conclusion ?? data?.output;
    const perspectives = data?.perspectives ?? data?.debate ?? [];
    const parts: string[] = [];
    if (Array.isArray(perspectives) && perspectives.length > 0) {
      parts.push("**Council Debate:**");
      perspectives.forEach((p: any) => {
        if (p.role && p.view) parts.push(`_${p.role}:_ ${String(p.view).slice(0, 400)}`);
      });
    }
    if (synthesis) parts.push(`\n**Council Synthesis:** ${synthesis}`);
    return { skillName: "council-session", output: parts.join("\n\n") || JSON.stringify(data) };
  } catch (err) {
    return { skillName: "council-session", output: `Council session error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "council-session",
  description: "Runs a multi-perspective AI council debate to stress-test decisions and synthesize truth",
  keywords: [
    "council", "run council", "council session", "multiple perspectives",
    "debate this", "get different views", "stress test this idea",
    "what would a skeptic say", "council opinion", "devil's advocate",
    "different angles on", "council debate",
  ],
}, handler);
