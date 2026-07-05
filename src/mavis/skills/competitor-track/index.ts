// SKILL: competitor-track
// Monitors competitors and surfaces intel via mavis-competitor-monitor.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "competitor-track", output: "Tell me which competitor to track. Example: 'monitor Notion for product updates' or 'what has OpenAI shipped this month?'" };
  }
  const competitor = input.replace(/^(monitor|track|watch|spy on|analyze|what has|what did)\s+/i, "").replace(/\s+(for|about|this month|recently|lately).*$/i, "").trim().split(/\s+/).slice(0, 3).join(" ");
  try {
    const { data, error } = await supabase.functions.invoke("mavis-competitor-monitor", {
      body: { competitor: competitor || input.trim(), query: input.trim() },
    });
    if (error) throw error;
    const result = data?.intel ?? data?.updates ?? data?.report ?? data?.result ?? data?.output;
    return { skillName: "competitor-track", output: result ? `🕵️ **Competitor Intel: ${competitor}**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "competitor-track", output: `Competitor tracking failed: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "competitor-track",
  description: "Monitors competitors and surfaces product updates, pricing, and strategy intel",
  keywords: [
    "competitor", "monitor competitor", "track competitor", "competitor update",
    "what has", "competitor intel", "rival news", "spy on", "watch competitor",
    "competitor analysis", "what did they ship", "competitor pricing",
  ],
}, handler);
