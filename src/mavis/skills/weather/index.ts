// SKILL: weather
// Fetches weather and forecasts via mavis-weather.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "weather", output: "Ask about any city's weather. Example: 'weather in Miami' or 'will it rain tomorrow in LA?'" };
  }
  const locationMatch = input.match(/\b(?:in|for|at|near)\s+([A-Za-z\s,]+?)(?:\s+(?:tomorrow|today|this week|forecast|\?)|$)/i);
  const location = locationMatch?.[1]?.trim() ?? input.replace(/weather|forecast|will it rain|temperature/gi, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-weather", {
      body: { location: location || "current location", query: input.trim() },
    });
    if (error) throw error;
    const result = data?.summary ?? data?.weather ?? data?.forecast ?? data?.output;
    return { skillName: "weather", output: result ? `🌤️ ${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "weather", output: `Weather fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "weather",
  description: "Gets current weather conditions and forecasts for any location",
  keywords: [
    "weather", "forecast", "will it rain", "temperature today", "what's the weather",
    "weather in", "weather for", "is it going to rain", "how hot is it",
    "how cold is it", "weather tomorrow", "this week weather",
  ],
}, handler);
