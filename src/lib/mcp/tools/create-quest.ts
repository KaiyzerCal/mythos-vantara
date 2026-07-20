import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated, errorResult, jsonResult } from "./_supabase";

export default defineTool({
  name: "create_quest",
  title: "Create quest",
  description: "Create a new quest (task/goal) for the signed-in user.",
  inputSchema: {
    description: z.string().min(1).describe("What the quest is."),
    category: z.string().optional(),
    difficulty: z.enum(["easy", "medium", "hard", "epic", "legendary"]).optional(),
    deadline: z.string().optional().describe("ISO 8601 datetime."),
    codex_points_reward: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("quests")
      .insert({
        user_id: ctx.getUserId(),
        description: input.description,
        category: input.category ?? null,
        difficulty: input.difficulty ?? "medium",
        deadline: input.deadline ?? null,
        codex_points_reward: input.codex_points_reward ?? 10,
      })
      .select()
      .single();
    if (error) return errorResult(error.message);
    return jsonResult(data);
  },
});
