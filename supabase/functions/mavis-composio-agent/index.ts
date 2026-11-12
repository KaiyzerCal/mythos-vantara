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
    const body = await req.json().catch(() => ({})) as { action?: string; tool_slug?: string; toolkit_slug?: string; connected_account_id?: string; params?: Record<string, unknown>; user_id?: string };
    const userId = await resolveUserId(req, body.user_id);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await adminSb.from("profiles").select("composio_enabled").eq("id", userId).maybeSingle();
    if (!profile?.composio_enabled) {
      return json({ successful: false, error: "Composio isn't enabled for this operator. Toggle it on in Settings → Integrations." }, 403);
    }

    if (!COMPOSIO_API_KEY) {
      await adminSb.from("mavis_events").insert({
        event_name: "fallback_triggered",
        user_id: userId,
        metadata: { function: "mavis-composio-agent", reason: "COMPOSIO_API_KEY not set" },
      }).then(() => {}, () => {});
      return json({ successful: false, error: "COMPOSIO_API_KEY is not configured. See Track A of the Execution Blueprint's Stage G." }, 503);
    }

    // Composio's v3 REST API. Verified against a live account: execute wants `user_id` (snake_case; the original `userId`
    // answered 400 "User ID is required with connected account"), and a connection link needs an auth_config_id, not a
    // toolkit slug. Errors are passed through verbatim so a shape mismatch is visible instead of silent.
    const cx = async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`${COMPOSIO_BASE}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", "x-api-key": COMPOSIO_API_KEY },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* non-JSON */ }
      return { ok: res.ok, status: res.status, data, text };
    };
    const fail = (r: { status: number; text: string }, what: string) =>
      json({ successful: false, error: `Composio ${what} ${r.status}: ${r.text.slice(0, 500)}` }, r.status >= 500 ? 502 : r.status);
    const items = (d: any): any[] => d?.items ?? d?.data ?? (Array.isArray(d) ? d : []);

    // ── Connect-account flow (Settings -> Integrations "Connect an app") ───
    if (body.action === "connect") {
      const slug = String(body.toolkit_slug ?? "").trim().toLowerCase();
      if (!slug) return json({ error: "toolkit_slug is required" }, 400);

      // 1. An existing auth config for the toolkit, else create a Composio-managed one.
      let authConfigId: string | null = null;
      const found = await cx(`/auth_configs?toolkit_slug=${encodeURIComponent(slug)}`);
      if (found.ok) {
        const list = items(found.data);
        authConfigId = (list.find((c: any) => String(c.status ?? "ENABLED").toUpperCase() === "ENABLED") ?? list[0])?.id ?? null;
      }
      if (!authConfigId) {
        const made = await cx("/auth_configs", {
          method: "POST",
          body: JSON.stringify({ toolkit: { slug }, auth_config: { type: "use_composio_managed_auth" } }),
        });
        if (!made.ok) return fail(made, "create auth config");
        authConfigId = made.data?.auth_config?.id ?? made.data?.id ?? null;
        if (!authConfigId) return json({ error: `Composio created an auth config but returned no id: ${made.text.slice(0, 300)}` }, 502);
      }

      // 2. A hosted authorization link for this operator.
      const link = await cx("/connected_accounts/link", {
        method: "POST",
        body: JSON.stringify({ auth_config_id: authConfigId, user_id: userId }),
      });
      if (!link.ok) return fail(link, "create link");
      const connectUrl = link.data?.redirect_url ?? link.data?.connection_url ?? link.data?.url ?? null;
      return json({ connect_url: connectUrl, connected_account_id: link.data?.connected_account_id ?? null });
    }

    // ── What is connected for this operator ────────────────────────────────
    if (body.action === "status") {
      const r = await cx(`/connected_accounts?user_ids=${encodeURIComponent(userId)}&limit=50`);
      if (!r.ok) return fail(r, "list connections");
      const accounts = items(r.data).map((c: any) => ({
        toolkit: c.toolkit?.slug ?? c.toolkit_slug ?? null, status: c.status ?? null, id: c.id ?? null,
      }));
      return json({ accounts });
    }

    const toolSlug = String(body.tool_slug ?? "").trim();
    if (!toolSlug) return json({ error: "tool_slug is required" }, 400);

    const exec = await cx(`/tools/execute/${encodeURIComponent(toolSlug)}`, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        arguments: body.params ?? {},
        ...(body.connected_account_id ? { connected_account_id: body.connected_account_id } : {}),
      }),
    });
    if (!exec.ok) return fail(exec, "execute");
    return json(exec.data ?? { successful: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ successful: false, error: message }, 500);
  }
});
