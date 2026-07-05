// SKILL: world-monitor
// Monitors global events, geopolitical shifts, and breaking news via mavis-worldmonitor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "world-monitor", output: "Monitor global events. Example: 'world monitor middle east' or 'global events today'" };
  }
  const topic = input.replace(/^(world monitor|global events|world news|geopolitical)\s*/i, "").trim() || "global";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-worldmonitor", {
      body: { topic, depth: "summary" },
    });
    if (error) throw error;
    const result = data?.events ?? data?.news ?? data?.output;
    return { skillName: "world-monitor", output: result ? `🌍 **World Monitor:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "world-monitor", output: `World monitor error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "world-monitor",
  description: "Monitors global events, geopolitical developments, and breaking world news",
  keywords: [
    "world monitor", "global events", "world news", "geopolitical", "international news",
    "breaking news global", "world watch", "global crisis", "world update",
  ],
}, handler);
