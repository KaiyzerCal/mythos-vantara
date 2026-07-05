// SKILL: economics-calendar
// Fetches global economic calendar events via Apify bleffoo/economics-calendar-scraper.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, _input) => {
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "bleffoo/economics-calendar-scraper", input: {}, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.events ?? data;
    return { skillName: "economics-calendar", output: result ? `📅 **Economic Calendar:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "economics-calendar", output: `Economics calendar error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "economics-calendar",
  description: "Fetches global economic calendar — CPI, Fed meetings, earnings, GDP releases",
  keywords: [
    "economic calendar", "economics calendar", "macro events", "fed calendar",
    "cpi release", "economic events this week", "macro calendar",
  ],
}, handler);
