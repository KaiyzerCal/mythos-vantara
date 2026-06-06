// mavis-heartbeat — OpenHuman 20-min auto-sync coordinator
// Runs all integration sync functions in parallel for users with active tokens
// Logs results to mavis_sync_log

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Sync functions that have corresponding edge functions
const SYNC_FUNCTIONS = [
  { name: "gmail",          fn: "mavis-gmail-sync",         token_provider: "google" },
  { name: "gdrive",         fn: "mavis-gdrive-sync",         token_provider: "google" },
  { name: "gcontacts",      fn: "mavis-gcontacts-sync",      token_provider: "google" },
  { name: "calendar",       fn: "mavis-calendar-sync",       token_provider: "google" },
  { name: "google_tasks",   fn: "mavis-google-tasks-sync",   token_provider: "google" },
  { name: "spotify",        fn: "mavis-spotify-sync",        token_provider: "spotify" },
  { name: "strava",         fn: "mavis-strava-sync",         token_provider: "strava" },
  { name: "oura",           fn: "mavis-oura-sync",           token_provider: "oura" },
  { name: "whoop",          fn: "mavis-whoop-sync",          token_provider: "whoop" },
  { name: "github",         fn: "mavis-github-sync",         token_provider: "github" },
  { name: "readwise",       fn: "mavis-readwise-import",     token_provider: "readwise" },
];

async function syncForUser(
  userId: string,
  sb: ReturnType<typeof createClient>,
  syncFn: typeof SYNC_FUNCTIONS[0],
): Promise<{ status: "success" | "skipped" | "error"; records: number; ms: number; msg?: string }> {
  const start = Date.now();

  // Check if user has a token for this provider
  const { data: integration } = await sb
    .from("mavis_user_integrations")
    .select("id, status")
    .eq("user_id", userId)
    .eq("provider", syncFn.token_provider)
    .eq("status", "active")
    .maybeSingle();

  if (!integration) {
    return { status: "skipped", records: 0, ms: Date.now() - start };
  }

  try {
    const resp = await fetch(`${SB_URL}/functions/v1/${syncFn.fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SB_KEY}`,
      },
      body: JSON.stringify({ user_id: userId, trigger: "heartbeat" }),
    });

    const data = await resp.json().catch(() => ({}));
    const records = data?.records_synced ?? data?.count ?? 0;
    return { status: resp.ok ? "success" : "error", records, ms: Date.now() - start, msg: data?.error };
  } catch (err: any) {
    return { status: "error", records: 0, ms: Date.now() - start, msg: err.message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const isScheduled = body.scheduled === true;

    // Determine which users to sync
    let userIds: string[] = [];
    if (body.user_id) {
      userIds = [body.user_id];
    } else if (isScheduled) {
      // Get all users with at least one active integration
      const { data: integrations } = await sb
        .from("mavis_user_integrations")
        .select("user_id")
        .eq("status", "active");
      userIds = [...new Set((integrations ?? []).map((r: any) => r.user_id))];
    } else {
      return new Response(JSON.stringify({ error: "user_id required for manual trigger" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalSynced = 0;
    let totalErrors = 0;

    for (const userId of userIds) {
      // Run all sync functions in parallel for this user
      const results = await Promise.all(
        SYNC_FUNCTIONS.map(async (syncFn) => {
          const result = await syncForUser(userId, sb, syncFn);

          // Log to mavis_sync_log
          await sb.from("mavis_sync_log").insert({
            user_id: userId,
            sync_type: syncFn.name,
            status: result.status,
            records_synced: result.records,
            duration_ms: result.ms,
            error_message: result.msg ?? null,
          });

          return result;
        })
      );

      totalSynced += results.filter(r => r.status === "success").length;
      totalErrors += results.filter(r => r.status === "error").length;
    }

    // Prune old sync logs (keep last 200 per user)
    for (const userId of userIds.slice(0, 10)) {
      const { data: old } = await sb
        .from("mavis_sync_log")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(200, 10000);
      if (old?.length) {
        await sb.from("mavis_sync_log").delete().in("id", old.map((r: any) => r.id));
      }
    }

    return new Response(
      JSON.stringify({ ok: true, users_processed: userIds.length, syncs_succeeded: totalSynced, syncs_errored: totalErrors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("mavis-heartbeat error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
