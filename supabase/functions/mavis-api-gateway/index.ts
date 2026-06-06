import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// verify_jwt = false in config.toml — this function uses its own API key auth
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mavis-api-key",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = req.headers.get("x-mavis-api-key") ?? "";
    if (!apiKey) return json({ error: "Missing x-mavis-api-key header" }, 401);

    const keyHash = await sha256Hex(apiKey);

    const sb = createClient(SB_URL, SB_KEY);

    const { data: keyRecord, error: keyErr } = await sb
      .from("mavis_api_keys")
      .select("id, user_id, permissions, requests_count, name")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyErr || !keyRecord) return json({ error: "Invalid or inactive API key" }, 401);

    const body = await req.json().catch(() => ({}));
    const endpoint = String(body.endpoint ?? "").trim();
    const payload  = (body.payload ?? {}) as Record<string, unknown>;

    if (!endpoint) return json({ error: "endpoint is required in body" }, 400);

    // Check the key's permission list includes the requested endpoint
    const permissions = Array.isArray(keyRecord.permissions) ? keyRecord.permissions as string[] : [];
    if (!permissions.includes(endpoint)) {
      return json({ error: `API key does not have permission for endpoint '${endpoint}'` }, 403);
    }

    // Update usage stats — fire and forget, don't block the response
    sb.from("mavis_api_keys").update({
      last_used_at:   new Date().toISOString(),
      requests_count: (keyRecord.requests_count ?? 0) + 1,
    }).eq("id", keyRecord.id).then(() => {}).catch(() => {});

    const serviceHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SB_KEY}`,
    };

    let downstreamRes: Response;

    if (endpoint === "chat") {
      downstreamRes = await fetch(`${SB_URL}/functions/v1/mavis-chat`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({ ...payload, _gateway_user_id: keyRecord.user_id }),
        signal: AbortSignal.timeout(60000),
      });
    } else if (endpoint === "memory") {
      downstreamRes = await fetch(`${SB_URL}/functions/v1/mavis-knowledge`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({ ...payload, _gateway_user_id: keyRecord.user_id }),
        signal: AbortSignal.timeout(30000),
      });
    } else if (endpoint === "task") {
      const { error: taskErr } = await sb.from("mavis_tasks").insert({
        user_id:     keyRecord.user_id,
        type:        String(payload.type ?? "api_task"),
        description: String(payload.description ?? ""),
        status:      "pending",
        metadata:    payload.metadata ?? {},
        created_at:  new Date().toISOString(),
      });
      if (taskErr) throw taskErr;
      return json({ ok: true, queued: true });
    } else if (endpoint === "sms") {
      downstreamRes = await fetch(`${SB_URL}/functions/v1/mavis-sms`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({ ...payload, _gateway_user_id: keyRecord.user_id }),
        signal: AbortSignal.timeout(30000),
      });
    } else {
      return json({ error: `Unknown endpoint '${endpoint}'. Valid: chat, memory, task, sms` }, 400);
    }

    const downstreamBody = await downstreamRes.text();
    return new Response(downstreamBody, {
      status: downstreamRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": downstreamRes.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
