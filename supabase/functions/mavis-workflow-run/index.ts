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
  | "query_db"
  | "condition"
  | "for_each"
  | "set_variable";

interface Step {
  id: string;
  type: StepType;
  name: string;
  config: Record<string, any>;
  // For condition: branches = { true: Step[], false: Step[] }
  branches?: { true?: Step[]; false?: Step[] };
  // For for_each: body = Step[]
  body?: Step[];
}

// ─── Step executor ────────────────────────────────────────────

// Resolve {{varName}} and {{output}} template strings
function resolveTemplate(template: string, prevOutput: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{output\}\}/g, prevOutput)
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

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
  vars: Record<string, string> = {},
  stepsLog: any[] = [],
): Promise<string> {
  const c = step.config;
  const resolve = (s: string) => resolveTemplate(s ?? "", prevOutput, vars);

  switch (step.type) {
    case "send_telegram": {
      const msg = resolve(c.message ?? prevOutput);
      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: msg }),
      });
      return `Telegram sent: ${msg.slice(0, 100)}`;
    }

    case "send_email": {
      const emailBody: Record<string, string> = {
        to: resolve(c.to ?? ""),
        from_name: resolve(c.from_name ?? "MAVIS"),
        subject: resolve(c.subject ?? ""),
      };
      if (c.generate_prompt) {
        emailBody.generate_prompt = resolve(c.generate_prompt);
      } else {
        emailBody.body = resolve(c.body ?? prevOutput);
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/mavis-email-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(emailBody),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Email send failed");
      return `Email sent to ${emailBody.to}`;
    }

    case "set_variable": {
      const varName = (c.var_name ?? "").trim();
      const varValue = resolve(c.value ?? prevOutput);
      if (varName) vars[varName] = varValue;
      return varValue;
    }

    case "condition": {
      const left = resolve(c.left ?? prevOutput);
      const right = resolve(c.right ?? "");
      let condResult = false;
      switch (c.operator ?? "equals") {
        case "equals": condResult = left === right; break;
        case "not_equals": condResult = left !== right; break;
        case "contains": condResult = left.includes(right); break;
        case "not_contains": condResult = !left.includes(right); break;
        case "gt": condResult = parseFloat(left) > parseFloat(right); break;
        case "lt": condResult = parseFloat(left) < parseFloat(right); break;
        case "truthy": condResult = !!left && left !== "false" && left !== "0"; break;
      }
      const branchSteps: Step[] = (condResult ? step.branches?.true : step.branches?.false) ?? [];
      let branchOutput = prevOutput;
      for (const bs of branchSteps) {
        const bStart = Date.now();
        let bOut = "", bErr = "";
        try {
          bOut = await executeStep(bs, uid, adminSb, branchOutput, claudeKey, telegramToken, chatId, supabaseUrl, serviceKey, vars, stepsLog);
          branchOutput = bOut;
        } catch (e: any) { bErr = e.message ?? "failed"; }
        stepsLog.push({ id: bs.id, name: bs.name, type: bs.type, status: bErr ? "failed" : "ok", output: bOut.slice(0, 500), error: bErr, duration_ms: Date.now() - bStart });
        if (bErr) throw new Error(`Condition branch failed: ${bErr}`);
      }
      return branchOutput;
    }

    case "for_each": {
      let items: any[] = [];
      try { items = JSON.parse(resolve(c.items ?? prevOutput)); } catch { items = []; }
      if (!Array.isArray(items)) items = [items];
      const bodySteps: Step[] = step.body ?? [];
      let lastOut = prevOutput;
      for (const item of items) {
        const itemStr = typeof item === "string" ? item : JSON.stringify(item);
        vars["item"] = itemStr;
        let iterOutput = itemStr;
        for (const bs of bodySteps) {
          const bStart = Date.now();
          let bOut = "", bErr = "";
          try {
            bOut = await executeStep(bs, uid, adminSb, iterOutput, claudeKey, telegramToken, chatId, supabaseUrl, serviceKey, vars, stepsLog);
            iterOutput = bOut;
          } catch (e: any) { bErr = e.message ?? "failed"; }
          stepsLog.push({ id: bs.id, name: bs.name, type: bs.type, status: bErr ? "failed" : "ok", output: bOut.slice(0, 500), error: bErr, duration_ms: Date.now() - bStart });
          if (bErr) throw new Error(`Loop body failed: ${bErr}`);
        }
        lastOut = iterOutput;
      }
      return lastOut;
    }

    case "mavis_generate": {
      const prompt = resolve(c.prompt ?? "Summarize: ");
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
      const res = await fetch(resolve(c.url ?? ""), {
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

    // Server-to-server: service role key + body.userId (called from mavis-actions)
    const token = authHeader?.slice(7) ?? "";
    if (token === serviceKey && body.userId) uid = String(body.userId);

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
    const vars: Record<string, string> = {};
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
          vars,
          stepsLog,
        );
        lastOutput = output;
      } catch (e: any) {
        error = e.message ?? "Step failed";
        success = false;
      }
      // condition/for_each push their own sub-step logs; only push top-level for non-compound steps
      const isCompound = step.type === "condition" || step.type === "for_each";
      if (!isCompound) {
        stepsLog.push({
          id: step.id,
          name: step.name,
          type: step.type,
          status: error ? "failed" : "ok",
          output: output.slice(0, 500),
          error,
          duration_ms: Date.now() - stepStart,
        });
      } else {
        stepsLog.push({
          id: step.id,
          name: step.name,
          type: step.type,
          status: error ? "failed" : "ok",
          output: error ? "" : `(${step.type} completed)`,
          error,
          duration_ms: Date.now() - stepStart,
        });
      }
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
