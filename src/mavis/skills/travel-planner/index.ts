// SKILL: travel-planner
// Builds a complete travel itinerary based on destination, dates, budget, and preferences.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  const query = input?.replace(/^\/?(travel|plan trip|travel planner|itinerary)\s*:?\s*/i, "").trim() || "help me plan a trip";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-chat", {
      body: {
        messages: [{ role: "user", content: query }],
        systemPrompt: `You are a meticulous travel planner. When the user asks for travel help, build a structured itinerary that includes: flights/transport options, accommodation recommendations by neighborhood, daily activities, estimated budget breakdown, packing checklist, and local tips. Ask clarifying questions if destination, dates, budget, or travel style are missing.`,
        mode: "PRIME",
        chatKind: "skill",
      },
    });
    if (error) throw error;
    return { skillName: "travel-planner", output: data?.content ?? "[No response]" };
  } catch (err) {
    return { skillName: "travel-planner", output: `Travel planner error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "travel-planner",
  description: "Builds complete travel itineraries with flights, stays, activities, budget, and packing lists",
  keywords: [
    "plan a trip", "travel itinerary", "book a trip", "travel planner", "vacation plan",
    "where should i go", "plan my travel", "itinerary for", "travel to",
  ],
}, handler);
