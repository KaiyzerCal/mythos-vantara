import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated, errorResult, jsonResult } from "./_supabase";

export default defineTool({
  name: "list_journal_entries",
  title: "List journal entries",
  description: "List the signed-in user's journal entries, most recent first.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional(),
    category: z.string().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, category }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    let q = supabaseForUser(ctx)
      .from("journal_entries")
      .select("id,title,content,category,mood,dominant_emotion,tags,importance,created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (category) q = q.eq("category", category);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult(data);
  },
});
