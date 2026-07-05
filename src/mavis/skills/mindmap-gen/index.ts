// SKILL: mindmap-gen
// Generate mind maps from topics or text via Apify MCP server agentify/mindmap-mcp-server.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "mindmap-gen", output: "Generate a mind map. Example: 'mindmap: digital marketing strategy' or 'create mind map for: product launch plan' or 'mind map: AI business ideas'" };
  }
  const topic = input.replace(/^(mindmap|create mind map for|mind map)\s*:?\s*/i, "").trim() || input;
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "agentify/mindmap-mcp-server", input: { topic, user_id: ctx.userId }, timeout: 60 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.mindmap ?? data;
    return { skillName: "mindmap-gen", output: result ? `🗺️ **Mind Map:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "mindmap-gen", output: `Mind map error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "mindmap-gen",
  description: "Generates visual mind maps from any topic or text — structured, exportable",
  keywords: [
    "mindmap", "mind map", "create mind map", "mind mapping",
    "generate mindmap", "brainstorm map", "concept map",
  ],
}, handler);
