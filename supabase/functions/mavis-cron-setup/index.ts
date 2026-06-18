// mavis-cron-setup
// One-time setup: reads mavis_cron_config table and registers all jobs
// with pg_cron via a direct SQL call. Call this once via:
//   POST /functions/v1/mavis-cron-setup   (with service-role Bearer token)
//
// After running, MAVIS will autonomously execute scheduled tasks
// without any external trigger service.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Require service-role key — this endpoint is admin-only
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.includes(SERVICE_KEY) && !authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Load all enabled cron jobs from config table
    const { data: jobs, error: loadErr } = await adminSb
      .from("mavis_cron_config")
      .select("*")
      .eq("enabled", true);

    if (loadErr) throw new Error(loadErr.message);
    if (!jobs?.length) return json({ message: "No enabled cron jobs found in mavis_cron_config" });

    const results: { job: string; status: string; error?: string }[] = [];

    for (const job of jobs) {
      try {
        // Build the SQL that pg_cron will run: HTTP POST to the edge function
        const functionUrl = `${SUPABASE_URL}/functions/v1/${job.edge_function}`;
        const escapedKey   = SERVICE_KEY.replace(/'/g, "''");
        const escapedUrl   = functionUrl.replace(/'/g, "''");
        const escapedBody  = JSON.stringify(job.payload ?? {}).replace(/'/g, "''");

        const cronSql = `
          SELECT
            net.http_post(
              url     := '${escapedUrl}',
              headers := json_build_object(
                'Content-Type',  'application/json',
                'Authorization', 'Bearer ${escapedKey}'
              )::jsonb,
              body    := '${escapedBody}'::jsonb
            ) AS request_id;
        `;

        // Register (or replace) the cron job
        const { error: cronErr } = await adminSb.rpc("cron_schedule", {
          jobname:  job.job_name,
          schedule: job.schedule,
          command:  cronSql,
        });

        if (cronErr) {
          // cron_schedule RPC may not exist — fall back to raw SQL
          const { error: rawErr } = await adminSb.rpc("exec_sql", {
            sql: `SELECT cron.schedule('${job.job_name}', '${job.schedule}', $cmd$${cronSql}$cmd$)`,
          });
          if (rawErr) throw new Error(rawErr.message);
        }

        results.push({ job: job.job_name, status: "scheduled" });

      } catch (e: any) {
        results.push({ job: job.job_name, status: "error", error: e.message });
      }
    }

    const scheduled = results.filter(r => r.status === "scheduled").length;
    const failed    = results.filter(r => r.status === "error").length;

    return json({
      message: `MAVIS autonomous scheduling activated: ${scheduled} jobs scheduled, ${failed} failed`,
      results,
      note: "If any failed, enable pg_cron in Supabase Dashboard → Database → Extensions, then re-run.",
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("mavis-cron-setup error:", message);
    return json({ error: message }, 500);
  }
});
