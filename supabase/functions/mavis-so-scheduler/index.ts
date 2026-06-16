// MAVIS Standing Order Scheduler
// Runs every 15 minutes. Finds active standing order templates that are due
// and inserts mavis_tasks rows for the task executor to pick up.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Convert a simple cron expression to milliseconds until the next run.
// Supports: "*/N * * * *" (every N min), "0 H * * *" (daily at H:00),
// "0 H * * D" (weekly), "0 H 1 * *" (monthly). Defaults to 24h.
function cronToNextMs(expr: string): number {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return 24 * 60 * 60 * 1000;
  const [minute, hour, dom, , dow] = parts;

  if (minute.startsWith("*/")) {
    const n = parseInt(minute.slice(2), 10);
    return (isNaN(n) ? 60 : n) * 60 * 1000;
  }
  if (hour.startsWith("*/")) {
    const n = parseInt(hour.slice(2), 10);
    return (isNaN(n) ? 1 : n) * 60 * 60 * 1000;
  }
  if (dom !== "*") return 30 * 24 * 60 * 60 * 1000; // monthly
  if (dow !== "*") return 7 * 24 * 60 * 60 * 1000;  // weekly
  if (hour !== "*") return 24 * 60 * 60 * 1000;     // daily
  return 60 * 60 * 1000;                             // hourly fallback
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const now = new Date().toISOString();

    // Pull all active/pinned templates that have a cron_expression and are due
    const { data: templates, error } = await supabase
      .from("standing_order_templates")
      .select("id, user_id, slug, name, instructions, cron_expression, next_run_at")
      .in("status", ["active", "pinned"])
      .not("cron_expression", "is", null)
      .or(`next_run_at.is.null,next_run_at.lte.${now}`);

    if (error) throw error;
    if (!templates || templates.length === 0) {
      return new Response(JSON.stringify({ status: "idle", message: "No templates due" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const queued: string[] = [];
    const failed: string[] = [];

    for (const tpl of templates as any[]) {
      try {
        // Skip if there's already a pending/running task for this template
        const { data: existing } = await supabase
          .from("mavis_tasks")
          .select("id")
          .eq("user_id", tpl.user_id)
          .eq("type", "standing_order")
          .in("status", ["pending", "running", "approved"])
          .eq("description", tpl.name)
          .limit(1);

        if (existing && existing.length > 0) {
          // Already queued — just bump next_run_at so we don't keep re-checking
          const nextMs = cronToNextMs(tpl.cron_expression);
          await supabase
            .from("standing_order_templates")
            .update({ next_run_at: new Date(Date.now() + nextMs).toISOString() })
            .eq("id", tpl.id);
          continue;
        }

        // Insert the task
        const { error: insertErr } = await supabase.from("mavis_tasks").insert({
          user_id: tpl.user_id,
          type: "standing_order",
          description: tpl.name,
          payload: {
            instructions: tpl.instructions,
            template_id: tpl.id,
            template_slug: tpl.slug,
            triggered_by: "scheduler",
          },
          status: "pending",
        });

        if (insertErr) throw insertErr;

        // Advance next_run_at
        const nextMs = cronToNextMs(tpl.cron_expression);
        await supabase
          .from("standing_order_templates")
          .update({ next_run_at: new Date(Date.now() + nextMs).toISOString() })
          .eq("id", tpl.id);

        queued.push(tpl.slug ?? tpl.name);
      } catch (err) {
        failed.push(`${tpl.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return new Response(JSON.stringify({ status: "ok", queued, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
