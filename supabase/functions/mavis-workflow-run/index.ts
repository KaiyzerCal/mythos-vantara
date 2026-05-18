// MAVIS Workflow Runner
// Executes a saved workflow by running its steps sequentially.
// The workflow engine for MAVIS.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Types ────────────────────────────────────────────────────

type StepType =
  | "send_telegram"
  | "send_email"
  | "http_request"
  | "mavis_generate"
  | "upsert_record"
  | "sync_connector"
  | "query_db";

interface Step {
  id: string;
  type: StepType;
  name: string;
  config: Record<string, any>;
}

// ─── Step executor ────────────────────────────────────────────

async function executeStep(
  step: Step,
  uid: string,
  adminSb: any,
  prevOutput: string,
  claudeKey: string,
  telegramToken: string,
  chatId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string> {
  const c = step.config;

  switch (step.type) {
    case "send_telegram": {
      const msg = (c.message ?? prevOutput).replace("{{output}}", prevOutput);
      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: msg }),
      });
      return `Telegram sent: ${msg.slice(0, 100)}`;
    }

    case "mavis_generate": {
      const prompt = (c.prompt ?? "Summarize: ").replace("{{output}}", prevOutput);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 512,
          system: c.system ?? "You are MAVIS, a helpful AI assistant.",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const d = await res.json();
      return d.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") ?? "";
    }

    case "http_request": {
      const res = await fetch(c.url, {
        method: c.method ?? "GET",
        headers: c.headers ?? {},
        body: c.body ? JSON.stringify(c.body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      return await res.text().then((t) => t.slice(0, 1000));
    }

    case "upsert_record": {
      const { error } = await adminSb.from(c.table).upsert({ ...c.data, user_id: uid });
      if (error) throw new Error(error.message);
      return `Upserted into ${c.table}`;
    }

    case "query_db": {
      let q = adminSb.from(c.table).select(c.columns ?? "*").eq("user_id", uid);
      if (c.filters) for (const [k, v] of Object.entries(c.filters)) q = q.eq(k, v);
      if (c.limit) q = q.limit(c.limit);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return JSON.stringify(data ?? []);
    }

    case "sync_connector": {
      const connectorMap: Record<string, string> = {
        oura: "mavis-oura-sync",
        strava: "mavis-strava-sync",
        github: "mavis-github-sync",
        gmail: "mavis-gmail-sync",
        gdrive: "mavis-gdrive-sync",
        spotify: "mavis-spotify-sync",
        hn: "mavis-hn-digest",
        weather: "mavis-weather",
      };
      const fn = connectorMap[c.connector];
      if (!fn) throw new Error(`Unknown connector: ${c.connector}`);
      const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ user_id: uid }),
      });
      return JSON.stringify(await res.json());
    }

    default:
      return `Unknown step type: ${(step as any).type}`;
  }
}

// ─── Main handler ─────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    const chatId = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

    const adminSb = createClient(supabaseUrl, serviceKey);

    // Auth: Bearer token → uid, or fallback to TELEGRAM_OPERATOR_USER_ID
    let uid: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await adminSb.auth.getUser(token);
      uid = user?.id ?? null;
    }
    if (!uid) {
      uid = Deno.env.get("TELEGRAM_OPERATOR_USER_ID") ?? null;
    }
    if (!uid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const workflowId: string | undefined = body.workflow_id;
    let steps: Step[] = body.steps ?? [];
    let workflowName: string = body.name ?? "Ad-hoc Workflow";

    // Load workflow from DB if workflow_id provided
    if (workflowId) {
      const { data: wf } = await adminSb
        .from("workflows")
        .select("*")
        .eq("id", workflowId)
        .eq("user_id", uid)
        .single();

      if (!wf) {
        return new Response(JSON.stringify({ error: "Workflow not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      steps = wf.steps ?? [];
      workflowName = wf.name;
    }

    // Create run log
    const { data: runRow } = await adminSb
      .from("workflow_runs")
      .insert({
        workflow_id: workflowId ?? null,
        user_id: uid,
        status: "running",
        steps_log: [],
      })
      .select("id")
      .single();

    const runId = runRow?.id;

    // Execute steps sequentially
    const stepsLog: any[] = [];
    let lastOutput = "";
    let success = true;

    for (const step of steps) {
      const stepStart = Date.now();
      let output = "";
      let error = "";
      try {
        output = await executeStep(
          step,
          uid,
          adminSb,
          lastOutput,
          claudeKey,
          telegramToken,
          chatId,
          supabaseUrl,
          serviceKey,
        );
        lastOutput = output;
      } catch (e: any) {
        error = e.message ?? "Step failed";
        success = false;
      }
      stepsLog.push({
        id: step.id,
        name: step.name,
        type: step.type,
        status: error ? "failed" : "ok",
        output: output.slice(0, 500),
        error,
        duration_ms: Date.now() - stepStart,
      });
      if (error) break;
    }

    // Update run status
    await adminSb
      .from("workflow_runs")
      .update({
        status: success ? "completed" : "failed",
        steps_log: stepsLog,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    if (workflowId) {
      await adminSb
        .from("workflows")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: success ? "completed" : "failed",
        })
        .eq("id", workflowId);
    }

    return new Response(JSON.stringify({ success, run_id: runId, steps_log: stepsLog }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
