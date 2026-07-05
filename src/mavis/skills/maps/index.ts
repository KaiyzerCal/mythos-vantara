// SKILL: maps
// Directions, nearby places, and location lookup via mavis-maps.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "maps", output: "Ask for directions, nearby places, or travel time. Example: 'directions to LAX' or 'restaurants near me'" };
  }
  try {
    const { data, error } = await supabase.functions.invoke("mavis-maps", {
      body: { query: input.trim() },
    });
    if (error) throw error;
    const result = data?.result ?? data?.places ?? data?.directions ?? data?.output;
    return { skillName: "maps", output: result ? `📍 ${typeof result === "string" ? result : JSON.stringify(result, null, 2)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "maps", output: `Maps error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "maps",
  description: "Finds directions, nearby places, distances, and location info",
  keywords: [
    "directions to", "navigate to", "how far is", "nearby", "restaurants near",
    "places near me", "distance from", "find a", "closest", "how to get to",
    "route to", "map to", "where is", "find location",
  ],
}, handler);
