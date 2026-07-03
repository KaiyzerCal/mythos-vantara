import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Proxy to a self-hosted Flowise instance.
// Required secrets: FLOWISE_BASE_URL
// Optional secrets: FLOWISE_API_KEY, FLOWISE_DEFAULT_CHATFLOW_ID
//
// Body params:
//   chatflowId  — overrides FLOWISE_DEFAULT_CHATFLOW_ID
//   question    — user message (required)
//   chatId      — session ID; pass userId for per-user memory
//   history     — array of { role, content } prior messages
//   overrideConfig — per-request Flowise node overrides (model, temperature, etc.)

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const flowiseBase = Deno.env.get("FLOWISE_BASE_URL");
  const flowiseKey  = Deno.env.get("FLOWISE_API_KEY");

  // GET /mavis-flowise/chatflows — return catalog of available flows for the UI picker
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/chatflows")) {
    if (!flowiseBase) return json({ chatflows: [], error: "FLOWISE_BASE_URL not configured" });
    try {
      const headers: Record<string, string> = {};
      if (flowiseKey) headers["Authorization"] = `Bearer ${flowiseKey}`;
      const res = await fetch(`${flowiseBase}/api/v1/chatflows`, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Flowise ${res.status}`);
      const data = await res.json();
      const chatflows = (Array.isArray(data) ? data : data?.chatflows ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        description: f.description ?? "",
        type: f.type ?? "chatflow",
        deployed: f.deployed ?? false,
      }));
      return json({ chatflows });
    } catch (err) {
      return json({ chatflows: [], error: err instanceof Error ? err.message : String(err) });
    }
  }

  try {
    const body = await req.json();
    const { question, chatId, history = [], overrideConfig } = body;

    const flowiseBase = Deno.env.get("FLOWISE_BASE_URL");
    const flowiseKey  = Deno.env.get("FLOWISE_API_KEY");
    const defaultFlow = Deno.env.get("FLOWISE_DEFAULT_CHATFLOW_ID");

    if (!flowiseBase) {
      return json({
        error: "FLOWISE_BASE_URL not configured — add it in Supabase secrets",
        setup: "Deploy Flowise, then set FLOWISE_BASE_URL and FLOWISE_DEFAULT_CHATFLOW_ID",
      }, 503);
    }

    const chatflowId = body.chatflowId || defaultFlow;
    if (!chatflowId) {
      return json({
        error: "No chatflow ID — pass chatflowId in body or set FLOWISE_DEFAULT_CHATFLOW_ID secret",
      }, 400);
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (flowiseKey) headers["Authorization"] = `Bearer ${flowiseKey}`;

    const payload: Record<string, unknown> = { question, chatId };
    if (history.length > 0) payload.history = history;
    if (overrideConfig) payload.overrideConfig = overrideConfig;

    const res = await fetch(`${flowiseBase}/api/v1/prediction/${chatflowId}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Flowise ${res.status}: ${errText}`);
    }

    const data = await res.json();

    return json({
      content:        data.text ?? data.output ?? data.answer ?? JSON.stringify(data),
      chatId:         data.chatId ?? chatId,
      agentReasoning: data.agentReasoning ?? [],
      sourceDocuments: data.sourceDocuments ?? [],
      usedTools:      data.usedTools ?? [],
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
