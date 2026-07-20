import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated, errorResult, jsonResult } from "./_supabase";

export default defineTool({
  name: "list_quests",
  title: "List quests",
  description: "List the signed-in user's active quests (tasks/goals) with status, difficulty, and deadline.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).optional(),
    category: z.string().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, category }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    let q = supabaseForUser(ctx)
      .from("quests")
      .select("id,description,category,difficulty,deadline,phase,current_state,progress_current,codex_points_reward,created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (category) q = q.eq("category", category);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult(data);
  },
});
