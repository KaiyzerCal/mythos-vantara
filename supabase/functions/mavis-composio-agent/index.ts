// mavis-composio-agent — generic proxy to Composio (https://composio.dev) for
// third-party tool/integration execution. Execution Blueprint Stage G, Track
// A: "from this point forward, new third-party integrations MAVIS needs get
// built through mavis-composio-agent + a new action type, not as a new
// bespoke edge function."
//
// ⚠ CONFIDENCE NOTE — read before relying on this in production:
// Composio's own docs site (docs.composio.dev) and API host
// (backend.composio.dev) both blocked automated fetches while building this
// (403s, likely bot protection), so the exact request/response shape below
// is assembled from what COULD be confirmed externally — their TypeScript
// SDK's public method signature (`composio.tools.execute(slug, { userId,
// arguments })` → `{ data, successful }`) and a sibling endpoint path
// (`POST /api/v3/tools/execute/proxy`) — not a first-hand read of the v3
// REST reference for this exact endpoint. Auth header name (`x-api-key`) and
// the v3-only requirement (v1/v2 return 410, deprecated) ARE independently
// confirmed. Before relying on this for anything real: get a COMPOSIO_API_KEY
// (Track A step 1 — creating the account is Calvin's to do, not something
// this session can do), set it in Supabase secrets, and smoke-test one
// simple read-only action (e.g. a *_LIST_* or *_GET_* slug) against a real
// account before trusting the write path.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COMPOSIO_API_KEY = Deno.env.get("COMPOSIO_API_KEY") ?? "";
const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Service-role callers pass an explicit user_id — same trust pattern as
// mavis-youtube-ingest / mavis-deep-research / mavis-hyperframes this session.
async function resolveUserId(req: Request, bodyUserId?: string): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (token === SERVICE_KEY) return bodyUserId?.trim() || null;
  try {
    const { data } = await adminSb.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as { tool_slug?: string; params?: Record<string, unknown>; user_id?: string };
    const userId = await resolveUserId(req, body.user_id);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const toolSlug = String(body.tool_slug ?? "").trim();
    if (!toolSlug) return json({ error: "tool_slug is required" }, 400);

    if (!COMPOSIO_API_KEY) {
      // No silent fallback — surfaces in mavis_events so a missing key
      // doesn't stay invisible the way it did for the webhook gaps found
      // in Stage D.
      await adminSb.from("mavis_events").insert({
        event_name: "fallback_triggered",
        user_id: userId,
        metadata: { function: "mavis-composio-agent", reason: "COMPOSIO_API_KEY not set", tool_slug: toolSlug },
      }).then(() => {}, () => {});
      return json({ successful: false, error: "COMPOSIO_API_KEY is not configured. See Track A of the Execution Blueprint's Stage G." }, 503);
    }

    const res = await fetch(`${COMPOSIO_BASE}/tools/execute/${encodeURIComponent(toolSlug)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": COMPOSIO_API_KEY,
      },
      body: JSON.stringify({
        userId,
        arguments: body.params ?? {},
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok) {
      return json({ successful: false, error: `Composio ${res.status}: ${text.slice(0, 500)}` }, res.status >= 500 ? 502 : res.status);
    }

    return json(data ?? { successful: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ successful: false, error: message }, 500);
  }
});
