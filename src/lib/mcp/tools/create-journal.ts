import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated, errorResult, jsonResult } from "./_supabase";

export default defineTool({
  name: "create_journal_entry",
  title: "Create journal entry",
  description: "Create a new journal entry for the signed-in user.",
  inputSchema: {
    title: z.string().min(1),
    content: z.string().optional(),
    category: z.string().optional(),
    mood: z.string().optional(),
    tags: z.array(z.string()).optional(),
    importance: z.enum(["low", "normal", "high", "critical"]).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("journal_entries")
      .insert({
        user_id: ctx.getUserId(),
        title: input.title,
        content: input.content ?? "",
        category: input.category ?? "general",
        mood: input.mood ?? null,
        tags: input.tags ?? [],
        importance: input.importance ?? "normal",
      })
      .select()
      .single();
    if (error) return errorResult(error.message);
    return jsonResult(data);
  },
});
