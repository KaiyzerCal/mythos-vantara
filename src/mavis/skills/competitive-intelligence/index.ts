// SKILL: competitive-intelligence
// Calls mavis-competitor-monitor edge function to run a structured competitor scan.
// Pattern adapted from 500-AI-Agents-Projects #19 (competitive analysis agent).

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  const target = input?.trim() || "my main competitors";
  try {
    const { data, error } = await supabase.functions.invoke("mavis-competitor-monitor", {
      body: { query: target, depth: "standard" },
    });
    if (error) throw error;
    const output = data?.summary ?? data?.report ?? data?.output ?? JSON.stringify(data);
    return { skillName: "competitive-intelligence", output };
  } catch (err) {
    return {
      skillName: "competitive-intelligence",
      output: `Competitive scan failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

registerSkill({
  name: "competitive-intelligence",
  description: "Runs a structured competitor scan — market positioning, gaps, and strategic opportunities",
  keywords: [
    "competitor", "competitive", "competition", "rival", "market scan",
    "competitive analysis", "who are my competitors", "competitive landscape",
    "monitor competitors", "competitive intel", "comp intel",
  ],
}, handler);
