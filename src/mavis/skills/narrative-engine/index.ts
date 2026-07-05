// SKILL: narrative-engine
// Generates stories, lore, worldbuilding, and narrative arcs via mavis-narrative-engine.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "narrative-engine", output: "Give me a premise and I'll build a story, character arc, or world. Example: 'write a story about an AI that gains consciousness' or 'create lore for a sci-fi universe'" };
  }
  const format = /lore|worldbuilding|universe/i.test(input) ? "worldbuilding"
    : /character arc|character development/i.test(input) ? "character_arc"
    : /outline|plot outline|story structure/i.test(input) ? "outline"
    : "story";
  const premise = input.replace(/^(write|generate|create|tell me)\s+(a\s+)?(story|narrative|lore|tale|worldbuilding|character arc)\s+(about|for|of)?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-narrative-engine", {
      body: { premise, format, length: "medium" },
    });
    if (error) throw error;
    const narrative = data?.narrative ?? data?.story ?? data?.lore ?? data?.output;
    return { skillName: "narrative-engine", output: narrative ? `📖 **${format === "story" ? "Story" : format.replace("_", " ")}:**\n\n${narrative}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "narrative-engine", output: `Narrative engine error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "narrative-engine",
  description: "Generates stories, character arcs, worldbuilding lore, and narrative structures",
  keywords: [
    "write a story", "tell me a story", "story about", "narrative",
    "lore for", "worldbuilding", "character arc", "plot outline",
    "create a universe", "story prompt", "fiction", "write a tale",
  ],
}, handler);
