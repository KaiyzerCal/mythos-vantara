// mavis-webhook-dispatcher
// Generic outbound webhook with retry, HMAC-SHA256 signing, payload templating,
// and delivery logging. Connects MAVIS to any service without a dedicated function.
//
// Actions: dispatch | test | list_recent

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function dispatchWithRetry(
  url: string,
  payload: unknown,
  options: {
    method?: string;
    headers?: Record<string, string>;
    secret?: string;
    max_retries?: number;
    timeout_ms?: number;
  }
): Promise<{ success: boolean; status: number; response: string; attempts: number }> {
  const body    = JSON.stringify(payload);
  const method  = options.method ?? "POST";
  const retries = Math.min(options.max_retries ?? 3, 5);
  const timeout = Math.min(options.timeout_ms ?? 10000, 30000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-MAVIS-Timestamp": new Date().toISOString(),
    ...(options.headers ?? {}),
  };

  if (options.secret) {
    headers["X-MAVIS-Signature"] = `sha256=${await hmacSign(options.secret, body)}`;
  }

  let lastStatus = 0;
  let lastResponse = "";
  let attempts = 0;

  for (let attempt = 0; attempt < retries; attempt++) {
    attempts++;
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method !== "GET" ? body : undefined,
        signal: AbortSignal.timeout(timeout),
      });

      lastStatus   = res.status;
      lastResponse = (await res.text()).slice(0, 500);

      if (res.ok) return { success: true, status: lastStatus, response: lastResponse, attempts };

      // Don't retry 4xx (permanent client errors)
      if (res.status >= 400 && res.status < 500) break;

    } catch (err) {
      lastResponse = err instanceof Error ? err.message : String(err);
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  return { success: false, status: lastStatus, response: lastResponse, attempts };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "dispatch");
    const sb     = createClient(SB_URL, SB_SRK);

    switch (action) {
      case "dispatch": {
        const url     = String(body.url ?? body.webhook_url ?? "");
        const payload = body.payload ?? body.data ?? {};
        if (!url) return json({ error: "url required" }, 400);

        // Template substitution: replace {{key}} in payload string with values from body.variables
        let finalPayload = payload;
        if (body.variables && typeof body.variables === "object") {
          const rendered = JSON.stringify(payload);
          const substituted = rendered.replace(/\{\{(\w+)\}\}/g, (_m, key) =>
            (body.variables as Record<string, string>)[key] ?? `{{${key}}}`
          );
          try { finalPayload = JSON.parse(substituted); } catch { finalPayload = payload; }
        }

        const result = await dispatchWithRetry(url, finalPayload, {
          method:      body.method,
          headers:     body.headers as Record<string, string> | undefined,
          secret:      body.secret,
          max_retries: body.max_retries,
          timeout_ms:  body.timeout_ms,
        });

        // Log to mavis_tasks for visibility
        if (body.user_id ?? body.userId) {
          await sb.from("mavis_tasks").insert({
            user_id:     body.user_id ?? body.userId,
            type:        "webhook_dispatch",
            description: `Webhook → ${url.split("/").slice(0, 4).join("/")}`,
            status:      result.success ? "completed" : "failed",
            payload:     { url, payload: finalPayload },
            result:      result,
            completed_at: result.success ? new Date().toISOString() : undefined,
          }).catch(() => {});
        }

        return json(result);
      }

      case "test": {
        // Send a test ping to verify the endpoint is reachable
        const url = String(body.url ?? "");
        if (!url) return json({ error: "url required" }, 400);

        const result = await dispatchWithRetry(url, {
          event: "mavis.test",
          timestamp: new Date().toISOString(),
          message: "MAVIS webhook test — if you received this, the endpoint is configured correctly.",
        }, { max_retries: 1, timeout_ms: 8000 });

        return json({ ...result, url, reachable: result.success || result.status > 0 });
      }

      case "list_recent": {
        const userId = String(body.user_id ?? body.userId ?? "");
        if (!userId) return json({ error: "user_id required" }, 400);

        const { data } = await sb
          .from("mavis_tasks")
          .select("id, description, status, result, created_at, payload")
          .eq("user_id", userId)
          .eq("type", "webhook_dispatch")
          .order("created_at", { ascending: false })
          .limit(20);

        return json({ dispatches: data ?? [] });
      }

      default:
        return json({ error: `Unknown action: ${action}. Use: dispatch | test | list_recent` }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-webhook-dispatcher]", message);
    return json({ error: message }, 500);
  }
});
