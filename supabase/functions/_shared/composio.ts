// Composio access for the functions behind the Calendar / Email / Contacts tabs. Those tabs were written for a direct
// Google OAuth connection (the operator's own Google Cloud client), which was never set up. With Composio enabled and
// the Google accounts authorized there, the same functions use it instead.
//
//   composioReady(uid, toolkit)  — true only when the operator has Composio enabled in settings, the backend has the
//                                  key, and an ACTIVE connected account exists for the toolkit. Cached 60s per isolate.
//   composioRun(uid, slug, args) — runs one Composio tool as the operator and returns its `data`; throws with
//                                  Composio's own error text on failure.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const BASE = "https://backend.composio.dev/api/v3";
const key = () => Deno.env.get("COMPOSIO_API_KEY") ?? "";

async function cx(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-api-key": key() },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, data, text };
}

const cache = new Map<string, { at: number; toolkits: Set<string> }>();

/** Toolkits the operator has an ACTIVE Composio connection for, or an empty set if Composio is off / unconfigured. */
export async function composioToolkits(uid: string): Promise<Set<string>> {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < 60_000) return hit.toolkits;
  const out = new Set<string>();
  try {
    if (key()) {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
      const { data: profile } = await sb.from("profiles").select("composio_enabled").eq("id", uid).maybeSingle();
      if (profile?.composio_enabled) {
        const r = await cx(`/connected_accounts?user_ids=${encodeURIComponent(uid)}&limit=100`);
        if (r.ok) {
          for (const c of (r.data?.items ?? r.data?.data ?? [])) {
            if (String(c.status ?? "").toUpperCase() === "ACTIVE" && (c.toolkit?.slug ?? c.toolkit_slug)) {
              out.add(String(c.toolkit?.slug ?? c.toolkit_slug).toLowerCase());
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("[composio] toolkit lookup failed:", e instanceof Error ? e.message : e);
  }
  cache.set(uid, { at: Date.now(), toolkits: out });
  return out;
}

export async function composioReady(uid: string, toolkit: string): Promise<boolean> {
  return (await composioToolkits(uid)).has(toolkit.toLowerCase());
}

export async function composioRun(uid: string, slug: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await cx(`/tools/execute/${encodeURIComponent(slug)}`, {
    method: "POST",
    body: JSON.stringify({ user_id: uid, arguments: args }),
  });
  if (!r.ok) throw new Error(`Composio ${slug} ${r.status}: ${r.text.slice(0, 300)}`);
  if (r.data?.successful === false) throw new Error(`Composio ${slug}: ${String(r.data?.error ?? "failed").slice(0, 300)}`);
  return r.data?.data ?? r.data;
}
