/**
 * local-mesh-proxy — Edge function that proxies AI requests to a local Ollama
 * instance reachable via a configured tunnel (Tailscale / ngrok).
 *
 * This is an OPTIONAL path. Direct browser→Ollama also works when:
 *   - MAVIS is accessed from the local machine (localhost)
 *   - Ollama is configured with OLLAMA_ORIGINS="*"
 *
 * The proxy is useful for:
 *   - Mobile clients reaching a home OpenClaw machine via Tailscale
 *   - Keeping the local endpoint private (not exposing Ollama port to internet)
 *
 * Request: POST /local-mesh-proxy
 * Body: {
 *   tunnel_url: "https://xxx.ngrok.io" | "http://100.x.x.x:11434",
 *   model: "llama3.2:3b",
 *   messages: [{ role, content }],
 *   stream: false,
 *   options?: { temperature, num_ctx, ... }
 * }
 *
 * Response: proxied Ollama response (streaming or JSON)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // ── Auth: require valid Supabase session ──────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { tunnel_url, model, messages, stream = false, options = {} } = body;

    if (!tunnel_url || !model || !messages) {
      return new Response(JSON.stringify({ error: "Missing tunnel_url, model, or messages" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Proxy to Ollama ───────────────────────────────────────
    const ollamaRes = await fetch(`${tunnel_url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream, options }),
    });

    if (!ollamaRes.ok) {
      return new Response(JSON.stringify({ error: `Ollama returned ${ollamaRes.status}` }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // For streaming: pipe the SSE stream through
    if (stream && ollamaRes.body) {
      return new Response(ollamaRes.body, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
        },
      });
    }

    // Non-streaming: return JSON
    const json = await ollamaRes.json();
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
