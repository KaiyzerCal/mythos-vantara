// SKILL: demand-scan
// Scans market demand, trends, and opportunities via mavis-demand-scan.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "demand-scan", output: "Scan demand and market opportunity. Example: 'demand scan for AI fitness coaching apps' or 'what problems are people searching for in [niche]'" };
  }
  const niche = input.replace(/^(demand scan|demand for|scan demand|market demand|what.?s the demand)\s+(for\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-demand-scan", {
      body: { niche, sources: ["reddit", "twitter", "producthunt", "google_trends"], depth: "medium" },
    });
    if (error) throw error;
    const result = data?.report ?? data?.demand ?? data?.opportunities ?? data?.output;
    return { skillName: "demand-scan", output: result ? `📈 **Demand Scan: ${niche}**\n\n${result}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "demand-scan", output: `Demand scan error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "demand-scan",
  description: "Scans Reddit, Twitter, Google Trends, and Product Hunt for real market demand signals",
  keywords: [
    "demand scan", "market demand", "is there demand for", "what problems",
    "market opportunity", "niche demand", "pain points in", "what do people want",
    "trending problems", "demand research", "validate idea",
  ],
}, handler);
