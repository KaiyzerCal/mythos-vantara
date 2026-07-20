import { defineTool } from "@lovable.dev/mcp-js";
import { unauthenticated, jsonResult } from "./_supabase";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return the signed-in VANTARA user id and email for the connected client.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    return jsonResult({
      user_id: ctx.getUserId(),
      email: ctx.getUserEmail(),
      client_id: ctx.getClientId(),
    });
  },
});
