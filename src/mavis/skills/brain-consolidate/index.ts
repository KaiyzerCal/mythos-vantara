// SKILL: brain-consolidate
// Triggers memory consolidation — summarizes recent activity and distills insights via mavis-brain-consolidate.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-brain-consolidate", {
      body: { user_id: ctx.userId, scope: input?.trim() ?? "all", lookback_hours: 24 },
    });
    if (error) throw error;
    const result = data?.summary ?? data?.insights ?? data?.consolidated ?? data?.output;
    return {
      skillName: "brain-consolidate",
      output: result
        ? `🧠 **Memory Consolidated:**\n\n${result}`
        : "Memory consolidation complete — no new insights to surface.",
    };
  } catch (err) {
    return { skillName: "brain-consolidate", output: `Memory consolidation error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "brain-consolidate",
  description: "Consolidates recent memories and activity into distilled insights",
  keywords: [
    "consolidate memory", "summarize what i've done", "what did i learn",
    "distill insights", "brain consolidate", "compress memories",
    "what happened today", "memory summary", "review my activity",
  ],
}, handler);
