import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function corsResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Require Supabase Bearer token
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return corsResponse({ error: "Unauthorized" }, 401);
  }

  const lettaApiKey = Deno.env.get("LETTA_API_KEY");

  // Graceful fallback if LETTA_API_KEY not set
  if (!lettaApiKey) {
    return corsResponse({ error: "Letta not configured", configured: false });
  }

  const lettaBaseUrl = Deno.env.get("LETTA_API_URL") ?? "https://api.letta.com";
  const defaultAgentId = Deno.env.get("LETTA_AGENT_ID") ?? "";

  let body: any;
  try {
    body = await req.json();
  } catch {
    return corsResponse({ error: "Invalid JSON body" }, 400);
  }

  const { action, user_id, agent_id, message, memory_key, memory_value } = body as {
    action: "send_message" | "get_memory" | "update_memory";
    user_id: string;
    agent_id?: string;
    message?: string;
    memory_key?: string;
    memory_value?: string;
  };

  if (!action || !user_id) {
    return corsResponse({ error: "action and user_id are required" }, 400);
  }

  const resolvedAgentId = agent_id ?? defaultAgentId;
  if (!resolvedAgentId) {
    return corsResponse({ error: "agent_id is required (or set LETTA_AGENT_ID env var)" }, 400);
  }

  const lettaHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${lettaApiKey}`,
  };

  try {
    if (action === "send_message") {
      if (!message) {
        return corsResponse({ error: "message required for send_message action" }, 400);
      }
      const res = await fetch(`${lettaBaseUrl}/v1/agents/${resolvedAgentId}/messages`, {
        method: "POST",
        headers: lettaHeaders,
        body: JSON.stringify({ messages: [{ role: "user", content: message }] }),
      });
      const data: any = await res.json();
      if (!res.ok) {
        return corsResponse({ error: "Letta send_message failed", details: data }, res.status);
      }
      // Extract assistant response text from messages array
      const messages: any[] = data.messages ?? [];
      const assistantMsg = messages.find((m: any) => m.role === "assistant" || m.message_type === "assistant_message");
      const responseText = assistantMsg?.content ?? assistantMsg?.text ?? JSON.stringify(data);
      return corsResponse({ response: responseText, raw: data });
    }

    if (action === "get_memory") {
      const res = await fetch(`${lettaBaseUrl}/v1/agents/${resolvedAgentId}/memory`, {
        method: "GET",
        headers: lettaHeaders,
      });
      const data: any = await res.json();
      if (!res.ok) {
        return corsResponse({ error: "Letta get_memory failed", details: data }, res.status);
      }
      return corsResponse({ memory: data });
    }

    if (action === "update_memory") {
      if (!memory_key || memory_value === undefined) {
        return corsResponse({ error: "memory_key and memory_value required for update_memory action" }, 400);
      }
      const res = await fetch(`${lettaBaseUrl}/v1/agents/${resolvedAgentId}/memory`, {
        method: "PUT",
        headers: lettaHeaders,
        body: JSON.stringify({ [memory_key]: memory_value }),
      });
      const data: any = await res.json();
      if (!res.ok) {
        return corsResponse({ error: "Letta update_memory failed", details: data }, res.status);
      }
      return corsResponse({ updated: true, memory: data });
    }

    return corsResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    return corsResponse({ error: "Internal error", message: err?.message ?? String(err) }, 500);
  }
});
