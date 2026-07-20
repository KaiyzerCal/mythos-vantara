import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated, errorResult, jsonResult } from "./_supabase";

export default defineTool({
  name: "list_personas",
  title: "List personas",
  description: "List the signed-in user's Personas with archetype, role, and system prompt.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).optional(),
    active_only: z.boolean().optional().describe("If true, only return active personas."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, active_only }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    let q = supabaseForUser(ctx)
      .from("personas")
      .select("id,name,archetype,role,system_prompt,is_active,model,created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (active_only) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult(data);
  },
});
