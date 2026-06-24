// mavis-campaign-runner
// Executes multi-step autonomous campaigns — time-sequenced goals that MAVIS
// carries out without operator prompting. Runs every 4 hours via pg_cron.
//
// Campaigns are created via the create_campaign tool inside mavis-agent.
// Each step is a distinct action with an optional delay (delay_hours) that
// MAVIS waits after the previous step before running the next one.
//
// Step lifecycle: pending → running → completed | failed
// Campaign lifecycle: active → completed | cancelled | paused

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface CampaignStep {
  index: number;
  title: string;
  action_type: string;
  payload: Record<string, unknown>;
  delay_hours: number;
  condition: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  executed_at: string | null;
  result: string | null;
}

interface Campaign {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: string;
  steps: CampaignStep[];
  current_step: number;
  updated_at: string;
}

function hoursElapsed(since: string | null): number {
  if (!since) return 999_999;
  return (Date.now() - new Date(since).getTime()) / 3_600_000;
}

async function executeStep(
  campaign: Campaign,
  step: CampaignStep,
): Promise<{ success: boolean; response: string }> {
  const payloadText = Object.keys(step.payload ?? {}).length > 0
    ? `\nAction payload:\n${JSON.stringify(step.payload, null, 2)}`
    : "";

  const goal =
    `You are MAVIS executing step ${step.index + 1} of ${campaign.steps.length} in the campaign: "${campaign.title}".

${campaign.description ? `Campaign goal: ${campaign.description}\n` : ""}CURRENT STEP: "${step.title}"
Action type: ${step.action_type}${payloadText}

Execute this step now using your tools:
- Use queue_action with action_type="${step.action_type}" and the payload above
- If no payload is provided, construct an appropriate one based on the step title and campaign context
- After executing, confirm in one sentence what was done and note anything the operator should review`;

  try {
    const agentRes = await fetch(`${SUPABASE_URL}/functions/v1/mavis-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ user_id: campaign.user_id, goal, mode: "CAMPAIGN_STEP" }),
      signal: AbortSignal.timeout(90_000),
    });

    const data = agentRes.ok ? await agentRes.json() : { content: "", ok: false };
    return { success: agentRes.ok && data.ok !== false, response: String(data.content ?? "") };
  } catch (err) {
    return { success: false, response: err instanceof Error ? err.message : String(err) };
  }
}

async function runCampaign(
  campaign: Campaign,
  adminSb: ReturnType<typeof createClient>,
): Promise<{ stepsRun: number; completed: boolean }> {
  const steps = (campaign.steps ?? []) as CampaignStep[];
  const currentIdx = campaign.current_step ?? 0;

  // All steps done
  if (currentIdx >= steps.length) {
    await adminSb
      .from("mavis_campaigns")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
    return { stepsRun: 0, completed: true };
  }

  const step = steps[currentIdx];
  if (!step) return { stepsRun: 0, completed: false };

  // Enforce delay: wait delay_hours after previous step's executed_at
  if (currentIdx > 0 && (step.delay_hours ?? 0) > 0) {
    const prevStep = steps[currentIdx - 1];
    const elapsed = hoursElapsed(prevStep?.executed_at ?? null);
    if (elapsed < (step.delay_hours ?? 0)) {
      const hoursLeft = Math.ceil((step.delay_hours ?? 0) - elapsed);
      console.log(`[campaign-runner] campaign "${campaign.title}" step ${currentIdx + 1} waiting ${hoursLeft}h`);
      return { stepsRun: 0, completed: false };
    }
  }

  // Mark step as running
  const updatedSteps = [...steps];
  updatedSteps[currentIdx] = { ...step, status: "running" };
  await adminSb
    .from("mavis_campaigns")
    .update({ steps: updatedSteps, updated_at: new Date().toISOString() })
    .eq("id", campaign.id);

  // Execute step via mavis-agent
  const result = await executeStep(campaign, step);

  const now = new Date().toISOString();
  updatedSteps[currentIdx] = {
    ...step,
    status: result.success ? "completed" : "failed",
    executed_at: now,
    result: result.response.slice(0, 500),
  };

  const nextStep = currentIdx + 1;
  const allDone = nextStep >= steps.length;

  await adminSb.from("mavis_campaigns").update({
    steps:        updatedSteps,
    current_step: nextStep,
    status:       allDone ? "completed" : "active",
    updated_at:   now,
  }).eq("id", campaign.id);

  return { stepsRun: 1, completed: allDone };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Heartbeat: mark running
    adminSb.from("mavis_function_health").upsert({
      function_name: "mavis-campaign-runner",
      last_started_at: new Date().toISOString(),
      last_status: "running",
      run_count: 1,
      expected_interval_min: 240,
      updated_at: new Date().toISOString(),
    }, { onConflict: "function_name" }).catch(() => {});

    const body = await req.json().catch(() => ({})) as Record<string, string>;
    const action = body.action ?? "run";

    // ── run: process all active campaigns ─────────────────────────────────────
    if (action === "run") {
      const { data: campaigns } = await adminSb
        .from("mavis_campaigns")
        .select("id, user_id, title, description, status, steps, current_step, updated_at")
        .eq("status", "active")
        .order("created_at", { ascending: true });

      if (!campaigns?.length) return json({ ok: true, processed: 0 });

      const results: {
        campaign_id: string;
        title: string;
        steps_run: number;
        completed: boolean;
      }[] = [];

      for (const c of campaigns as Campaign[]) {
        try {
          const r = await runCampaign(c, adminSb);
          results.push({
            campaign_id: c.id,
            title:       c.title,
            steps_run:   r.stepsRun,
            completed:   r.completed,
          });
        } catch (err) {
          console.error(`[campaign-runner] campaign ${c.id} error:`, err);
          results.push({ campaign_id: c.id, title: c.title, steps_run: 0, completed: false });
        }
      }

      adminSb.from("mavis_function_health").upsert({
        function_name: "mavis-campaign-runner",
        last_completed_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
        run_count: 1,
        expected_interval_min: 240,
        updated_at: new Date().toISOString(),
      }, { onConflict: "function_name" }).catch(() => {});

      return json({ ok: true, processed: results.length, results });
    }

    // ── run_campaign: manually trigger a specific campaign (for testing) ───────
    if (action === "run_campaign") {
      const { campaign_id } = body;
      if (!campaign_id) return json({ ok: false, error: "campaign_id required" }, 400);

      const { data: campaign, error } = await adminSb
        .from("mavis_campaigns")
        .select("id, user_id, title, description, status, steps, current_step, updated_at")
        .eq("id", campaign_id)
        .single();

      if (error || !campaign) return json({ ok: false, error: "Campaign not found" }, 404);

      const result = await runCampaign(campaign as Campaign, adminSb);
      return json({ ok: true, campaign_id, ...result });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const _errMsg = err instanceof Error ? err.message : String(err);
    console.error("[mavis-campaign-runner]", _errMsg);
    const _errSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    _errSb.from("mavis_function_health").upsert({
      function_name: "mavis-campaign-runner",
      last_completed_at: new Date().toISOString(),
      last_status: "error",
      last_error: _errMsg.slice(0, 500),
      run_count: 1,
      error_count: 1,
      expected_interval_min: 240,
      updated_at: new Date().toISOString(),
    }, { onConflict: "function_name" }).catch(() => {});
    return json({ ok: false, error: _errMsg }, 500);
  }
});
