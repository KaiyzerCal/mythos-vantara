// SKILL: skill-catalog-browse
// Browses and searches the MAVIS skill catalog via mavis-skill-catalog.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const query = input?.replace(/^(browse skills|search skills|skill catalog|list skills|what skills)\s*:?\s*/i, "").trim() || "";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-skill-catalog", {
      body: { query, user_id: ctx.userId },
    });
    if (error) throw error;
    const result = data?.skills ?? data?.catalog ?? data?.output;
    return { skillName: "skill-catalog-browse", output: result ? `📚 **Skill Catalog:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "skill-catalog-browse", output: `Skill catalog error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "skill-catalog-browse",
  description: "Browse and search the full MAVIS skill catalog — discover what MAVIS can do",
  keywords: [
    "browse skills", "skill catalog", "list skills", "what can mavis do",
    "search skills", "show all skills", "skills catalog",
  ],
}, handler);
