// SKILL: figma-export
// Exports Figma designs and components via Apify MCP server bhansalisoft/figma-mcp-server.

import { registerSkill } from "../_registry";
import type { SkillHandler } from "../_registry";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;

const handler: SkillHandler = async (ctx, input) => {
  if (!input?.trim()) {
    return { skillName: "figma-export", output: "Export Figma designs. Example: 'figma export: https://figma.com/file/...' or 'get figma components from file' or 'figma design data'" };
  }
  const fileUrl = input.match(/https?:\/\/[^\s]+figma[^\s]*/i)?.[0] ?? input.replace(/^(figma export|get figma|figma design)\s*:?\s*/i, "").trim();
  try {
    const { data, error } = await supabase.functions.invoke("mavis-apify", {
      body: { actorId: "bhansalisoft/figma-mcp-server", input: { fileUrl, user_id: ctx.userId }, timeout: 90 },
    });
    if (error) throw error;
    const result = data?.output ?? data?.design ?? data;
    return { skillName: "figma-export", output: result ? `🎨 **Figma Export:**\n\n${typeof result === "string" ? result : JSON.stringify(result, null, 2).slice(0, 5000)}` : JSON.stringify(data) };
  } catch (err) {
    return { skillName: "figma-export", output: `Figma export error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

registerSkill({
  name: "figma-export",
  description: "Exports Figma designs, components, and assets — inspect, extract specs, download",
  keywords: [
    "figma export", "export figma", "figma design", "figma components",
    "figma file", "figma assets", "figma inspect",
  ],
}, handler);
