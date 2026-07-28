// mavis-hyperframes — proxy to an externally-hosted HyperFrames render service
// (https://github.com/KaiyzerCal/hyperframes). HyperFrames itself needs headless
// Chrome + FFmpeg + a persistent Node process, none of which a Deno edge function
// can host — this function only submits/polls jobs against a small wrapper API
// you run yourself. See DEPLOYMENT.md's "HyperFrames render service" section for
// what that wrapper needs to expose and how to stand it up.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RENDER_URL = (Deno.env.get("HYPERFRAMES_RENDER_URL") ?? "").replace(/\/+$/, "");
const RENDER_KEY = Deno.env.get("HYPERFRAMES_API_KEY") ?? "";

const adminSb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Service-role callers (e.g. mavis-chat's tool dispatch) pass an explicit user_id —
// same trust pattern as mavis-youtube-ingest / mavis-deep-research.
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

interface RenderBody {
  action: "render";
  user_id?: string;
  composition_html: string;
  assets?: string[];
  width?: number;
  height?: number;
  fps?: number;
}

interface StatusBody {
  action: "status";
  user_id?: string;
  id: string;
}

async function handleRender(userId: string, body: RenderBody) {
  const html = (body.composition_html ?? "").trim();
  if (!html) throw new Error("composition_html is required");
  if (!RENDER_URL) throw new Error("HYPERFRAMES_RENDER_URL is not configured");

  const width = Math.min(Math.max(Number(body.width ?? 1920), 1), 3840);
  const height = Math.min(Math.max(Number(body.height ?? 1080), 1), 2160);
  const fps = Math.min(Math.max(Number(body.fps ?? 30), 1), 60);
  const assets = Array.isArray(body.assets) ? body.assets.slice(0, 20) : [];

  const { data: row, error: insertErr } = await adminSb
    .from("hyperframes_renders")
    .insert({ user_id: userId, status: "queued", width, height, fps })
    .select("id")
    .single();
  if (insertErr) throw insertErr;

  try {
    const res = await fetch(`${RENDER_URL}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Render-Key": RENDER_KEY },
      body: JSON.stringify({ html, assets, width, height, fps }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`render service ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const providerJobId = String(data.job_id ?? "");
    if (!providerJobId) throw new Error("render service did not return a job_id");

    await adminSb.from("hyperframes_renders")
      .update({ status: "rendering", provider_job_id: providerJobId })
      .eq("id", row.id);

    return { id: row.id, status: "rendering", provider_job_id: providerJobId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await adminSb.from("hyperframes_renders").update({ status: "failed", error_message: message }).eq("id", row.id);
    throw new Error(message);
  }
}

async function handleStatus(userId: string, body: StatusBody) {
  const { data: row, error } = await adminSb
    .from("hyperframes_renders")
    .select("*")
    .eq("id", body.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) throw new Error("render job not found");

  if (row.status !== "rendering" || !row.provider_job_id) {
    return { id: row.id, status: row.status, render_url: row.render_url, error_message: row.error_message };
  }
  if (!RENDER_URL) throw new Error("HYPERFRAMES_RENDER_URL is not configured");

  const res = await fetch(`${RENDER_URL}/render/${encodeURIComponent(row.provider_job_id)}`, {
    headers: { "X-Render-Key": RENDER_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { id: row.id, status: row.status, render_url: row.render_url };
  const data = await res.json();

  if (data.status === "done" && data.output_url) {
    await adminSb.from("hyperframes_renders")
      .update({ status: "ready", render_url: data.output_url, completed_at: new Date().toISOString() })
      .eq("id", row.id);
    return { id: row.id, status: "ready", render_url: data.output_url };
  }
  if (data.status === "error") {
    const message = String(data.error ?? "render failed");
    await adminSb.from("hyperframes_renders")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", row.id);
    return { id: row.id, status: "failed", error_message: message };
  }
  return { id: row.id, status: "rendering" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as (RenderBody | StatusBody) & { user_id?: string };
    const userId = await resolveUserId(req, body.user_id);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    if (body.action === "render") return json(await handleRender(userId, body as RenderBody));
    if (body.action === "status") return json(await handleStatus(userId, body as StatusBody));
    return json({ error: "action must be 'render' or 'status'" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
