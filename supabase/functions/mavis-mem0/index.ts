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

  const mem0ApiKey = Deno.env.get("MEM0_API_KEY");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return corsResponse({ error: "Invalid JSON body" }, 400);
  }

  const { action, user_id, messages, query, limit } = body as {
    action: "add" | "search" | "get_all";
    user_id: string;
    messages?: Array<{ role: string; content: string }>;
    query?: string;
    limit?: number;
  };

  if (!action || !user_id) {
    return corsResponse({ error: "action and user_id are required" }, 400);
  }

  // Graceful fallback if MEM0_API_KEY not set
  if (!mem0ApiKey) {
    if (action === "add") return corsResponse({ results: [], skipped: true, reason: "MEM0_API_KEY not configured" });
    if (action === "search") return corsResponse({ results: [] });
    if (action === "get_all") return corsResponse({ results: [] });
  }

  const mem0Headers = {
    "Content-Type": "application/json",
    "Authorization": `Token ${mem0ApiKey}`,
  };

  try {
    if (action === "add") {
      if (!messages || !Array.isArray(messages)) {
        return corsResponse({ error: "messages array required for add action" }, 400);
      }
      const res = await fetch("https://api.mem0.ai/v1/memories", {
        method: "POST",
        headers: mem0Headers,
        body: JSON.stringify({ messages, user_id, output_format: "v1.1" }),
      });
      const data: any = await res.json();
      if (!res.ok) {
        return corsResponse({ error: "Mem0 add failed", details: data }, res.status);
      }
      return corsResponse({ results: data });
    }

    if (action === "search") {
      if (!query) {
        return corsResponse({ error: "query required for search action" }, 400);
      }
      const res = await fetch("https://api.mem0.ai/v1/memories/search", {
        method: "POST",
        headers: mem0Headers,
        body: JSON.stringify({ query, user_id, limit: limit ?? 5 }),
      });
      const data: any = await res.json();
      if (!res.ok) {
        return corsResponse({ error: "Mem0 search failed", details: data }, res.status);
      }
      // Normalize to array of { id, memory, score, metadata }
      const results = Array.isArray(data) ? data : (data.results ?? []);
      return corsResponse({ results });
    }

    if (action === "get_all") {
      const url = `https://api.mem0.ai/v1/memories?user_id=${encodeURIComponent(user_id)}&limit=${limit ?? 20}`;
      const res = await fetch(url, {
        method: "GET",
        headers: mem0Headers,
      });
      const data: any = await res.json();
      if (!res.ok) {
        return corsResponse({ error: "Mem0 get_all failed", details: data }, res.status);
      }
      const results = Array.isArray(data) ? data : (data.results ?? []);
      return corsResponse({ results });
    }

    return corsResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    return corsResponse({ error: "Internal error", message: err?.message ?? String(err) }, 500);
  }
});
