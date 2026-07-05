// SKILL: entity-graph
// Builds entity relationship graphs from text or topics via mavis-entity-graph.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (_ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "entity-graph", output: "Map entity relationships. Example: 'entity graph of OpenAI' or 'map connections between Elon Musk's companies'" };
  }
  const subject = input.replace(/^(entity graph|entity map|relationship map|map connections)\s*(of\s+|for\s+)?/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-entity-graph", {
      body: { subject, depth: 2 },
    });
    if (error) throw error;
    const result = data?.graph ?? data?.entities ?? data?.relationships ?? data?.output;
    return { skillName: "entity-graph", output: result ? `🕸️ **Entity Graph:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 4000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "entity-graph", output: `Entity graph error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "entity-graph",
  description: "Builds entity relationship graphs showing connections between people, companies, and concepts",
  keywords: [
    "entity graph", "relationship map", "entity connections", "knowledge graph",
    "map entities", "connection map", "entity relationships", "network graph",
    "link analysis", "entity network",
  ],
}, handler);
