import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated, errorResult, jsonResult } from "./_supabase";

export default defineTool({
  name: "list_councils",
  title: "List council members",
  description: "List the signed-in user's Council members (AI advisors) with role, specialty, and personality.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).optional().describe("Max rows. Default 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("councils")
      .select("id,name,role,specialty,class,personality_prompt,last_used_at,created_at")
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .limit(limit ?? 50);
    if (error) return errorResult(error.message);
    return jsonResult(data);
  },
});
