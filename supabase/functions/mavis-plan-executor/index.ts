// MAVIS Plan Executor
// Runs the steps of plans created on the Autonomy tab (mavis_plans / mavis_plan_steps).
// Until now those steps were saved as "pending" and nothing ever ran them.
//
// One step per plan per cycle, strictly in order:
//   research | write  -> LLM produces the text; saved as the step result. No side effects.
//   execute | create_quest | notify
//                     -> LLM proposes a few allow-listed actions, which go to the Inbox
//                        (`approvals`) for the operator. The step stays "running" until
//                        every proposal is approved/rejected, then becomes done/skipped.
//                        Nothing with a side effect runs without an explicit approval.
//   wait              -> done once estimated_minutes have passed since the previous step.
//
// Callers: the pg_cron job (service-role key -> every user's active plans) and the
// Autonomy tab's "Run cycle" button via the orchestrator (a user -> only their plans).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { aiComplete } from "../_shared/providers.ts";
import { isServiceRoleCaller } from "../_shared/auth.ts";

// Defined inline: supabase-js 2.49.4 has no "/cors" export, so importing it made this function fail to boot.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_PLANS_PER_RUN = 10;
const STUCK_RUNNING_MS = 20 * 60 * 1000; // a text step that has been "running" this long crashed
const PROPOSAL_TYPES = new Set([
  "create_quest", "update_quest", "create_task", "update_task",
  "create_skill", "update_skill", "create_journal", "update_journal",
  "create_vault", "update_vault", "create_inventory_item", "update_inventory_item",
  "create_ally", "update_ally", "update_profile", "award_xp",
]);

type Sb = ReturnType<typeof createClient>;
interface Step {
  id: string; plan_id: string; user_id: string; step_order: number | null; step_index: number;
  title: string; description: string | null; type: string; status: string;
  result: string | null; actions: any; started_at: string | null; completed_at: string | null;
  estimated_minutes: number | null;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const order = (s: Step) => s.step_order ?? s.step_index ?? 0;

function planContext(goal: string, steps: Step[], upTo: Step): string {
  const done = steps
    .filter((s) => order(s) < order(upTo) && s.result)
    .map((s) => `Step ${order(s) + 1} (${s.title}): ${String(s.result).slice(0, 700)}`)
    .join("\n");
  return `Overall goal: ${goal}\n\n${done ? `Results so far:\n${done}\n\n` : ""}Current step: ${upTo.title}\n${upTo.description ?? ""}`;
}

async function runTextStep(goal: string, steps: Step[], step: Step): Promise<string> {
  const { content } = await aiComplete({
    system:
      "You are MAVIS carrying out one step of a larger plan for the operator. Do the step: produce the concrete " +
      "output it calls for (findings, a draft, a decision with reasoning, a checklist). Be specific and concise " +
      "(under 250 words). You cannot browse the web or take actions here; work from the goal and earlier results, " +
      "and say plainly what you could not verify.",
    user: planContext(goal, steps, step),
  });
  const out = content.trim();
  if (!out) throw new Error("The AI returned an empty answer for this step.");
  return out.slice(0, 4000);
}

async function proposeActions(sb: Sb, goal: string, steps: Step[], step: Step): Promise<{ summary: string; approvalIds: string[] }> {
  const { content } = await aiComplete({
    system:
      "You turn one step of a plan into concrete app actions for the operator's RPG-style life system. Return STRICT JSON: " +
      `{"note": string, "actions": [{"type": string, "summary": string, "params": object}]}. ` +
      `Allowed types only: ${[...PROPOSAL_TYPES].join(", ")}. Propose 0-3 actions; propose none if the step needs ` +
      "something outside the app (then explain in note). Never invent ids; omit fields you don't know.",
    user: planContext(goal, steps, step),
  });
  let parsed: any;
  try { parsed = JSON.parse(content.replace(/```json|```/g, "").trim()); } catch { throw new Error("The AI's action proposal was not valid JSON."); }
  const actions = (Array.isArray(parsed?.actions) ? parsed.actions : [])
    .filter((a: any) => a && PROPOSAL_TYPES.has(String(a.type)))
    .slice(0, 3);
  const note = String(parsed?.note ?? "").slice(0, 600);
  if (!actions.length) return { summary: note || "No in-app action was needed for this step.", approvalIds: [] };

  const rows = actions.map((a: any) => ({
    user_id: step.user_id,
    action_type: String(a.type),
    action_summary: `[Plan: ${step.title}] ${String(a.summary ?? a.type)}`.slice(0, 255),
    action_payload: {
      type: String(a.type),
      params: a.params && typeof a.params === "object" ? a.params : {},
      proposed_by: "Plan executor", plan_id: step.plan_id, plan_step_id: step.id,
    },
    status: "pending",
  }));
  const { data, error } = await sb.from("approvals").insert(rows).select("id");
  if (error) throw new Error(`Could not queue proposals: ${error.message}`);
  return {
    summary: `${note ? note + " " : ""}Waiting for your approval in the Inbox: ${actions.map((a: any) => a.summary ?? a.type).join("; ")}`.slice(0, 1500),
    approvalIds: (data ?? []).map((r: any) => r.id),
  };
}

/** Advance a step that is waiting on Inbox approvals. Returns true if it is still waiting. */
async function settleWaitingStep(sb: Sb, step: Step): Promise<boolean> {
  const ids: string[] = Array.isArray(step.actions?.approval_ids) ? step.actions.approval_ids : [];
  if (!ids.length) return false;
  const { data } = await sb.from("approvals").select("id,status").in("id", ids);
  const rows = (data ?? []) as { id: string; status: string }[];
  if (rows.some((r) => r.status === "pending" || r.status === "executing")) return true; // still waiting
  const approved = rows.filter((r) => r.status === "approved").length;
  const now = new Date().toISOString();
  await sb.from("mavis_plan_steps").update(
    approved > 0
      ? { status: "done", completed_at: now, result: `${step.result ?? ""} — ${approved} of ${ids.length} proposal(s) approved and executed.`.trim() }
      : { status: "skipped", completed_at: now, result: `${step.result ?? ""} — all proposals were rejected.`.trim() },
  ).eq("id", step.id).eq("status", "running");
  return false;
}

async function processPlan(sb: Sb, plan: { id: string; user_id: string; goal: string }): Promise<string> {
  const { data } = await sb.from("mavis_plan_steps").select("*").eq("plan_id", plan.id);
  const steps = ((data ?? []) as Step[]).sort((a, b) => order(a) - order(b));
  if (!steps.length) return "no steps";

  // 1. A step already in flight blocks the plan (steps run strictly in order).
  const running = steps.find((s) => s.status === "running");
  if (running) {
    if (await settleWaitingStep(sb, running)) return `waiting on approvals for "${running.title}"`;
    const stillRunning = (await sb.from("mavis_plan_steps").select("status").eq("id", running.id).single()).data?.status === "running";
    if (stillRunning) {
      const age = Date.now() - new Date(running.started_at ?? 0).getTime();
      if (age < STUCK_RUNNING_MS) return `"${running.title}" is in progress`;
      await sb.from("mavis_plan_steps").update({ status: "failed", error: "Timed out while running.", completed_at: new Date().toISOString() }).eq("id", running.id);
    }
    return await finishIfDone(sb, plan.id);
  }

  // 2. A failed step stops the plan; the operator decides what to do.
  if (steps.some((s) => s.status === "failed")) {
    await sb.from("mavis_plans").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", plan.id);
    return "plan failed";
  }

  // 3. Next pending step.
  const step = steps.find((s) => s.status === "pending");
  if (!step) return await finishIfDone(sb, plan.id);

  if (step.type === "wait") {
    const prev = [...steps].reverse().find((s) => order(s) < order(step) && s.completed_at);
    const dueAt = new Date(prev?.completed_at ?? Date.now()).getTime() + (step.estimated_minutes ?? 60) * 60_000;
    if (Date.now() < dueAt) return `waiting until ${new Date(dueAt).toISOString()}`;
    await sb.from("mavis_plan_steps").update({ status: "done", completed_at: new Date().toISOString(), result: "Wait elapsed." }).eq("id", step.id).eq("status", "pending");
    return await finishIfDone(sb, plan.id);
  }

  // Claim it (so overlapping runs cannot execute it twice).
  const { data: claimed } = await sb.from("mavis_plan_steps")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", step.id).eq("status", "pending").select("id");
  if (!claimed?.length) return "step claimed by another run";

  try {
    if (step.type === "research" || step.type === "write") {
      const result = await runTextStep(plan.goal, steps, step);
      await sb.from("mavis_plan_steps").update({ status: "done", result, completed_at: new Date().toISOString() }).eq("id", step.id);
    } else {
      const { summary, approvalIds } = await proposeActions(sb, plan.goal, steps, step);
      if (approvalIds.length) {
        // Stay "running" until the Inbox decisions come in; settleWaitingStep closes it.
        await sb.from("mavis_plan_steps").update({ result: summary, actions: { approval_ids: approvalIds } }).eq("id", step.id);
        return `"${step.title}" queued ${approvalIds.length} proposal(s) for approval`;
      }
      await sb.from("mavis_plan_steps").update({ status: "done", result: summary, completed_at: new Date().toISOString() }).eq("id", step.id);
    }
  } catch (err) {
    await sb.from("mavis_plan_steps").update({
      status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500), completed_at: new Date().toISOString(),
    }).eq("id", step.id);
    await sb.from("mavis_plans").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", plan.id);
    return `"${step.title}" failed`;
  }
  return await finishIfDone(sb, plan.id, `ran "${step.title}"`);
}

async function finishIfDone(sb: Sb, planId: string, prefix = ""): Promise<string> {
  const { data } = await sb.from("mavis_plan_steps").select("status").eq("plan_id", planId);
  const rows = (data ?? []) as { status: string }[];
  const done = rows.filter((s) => s.status === "done" || s.status === "skipped").length;
  const complete = rows.length > 0 && done === rows.length;
  await sb.from("mavis_plans").update({
    done_steps: done, total_steps: rows.length, status: complete ? "completed" : "active", updated_at: new Date().toISOString(),
  }).eq("id", planId).in("status", ["active", "completed"]);
  return `${prefix}${prefix ? "; " : ""}${done}/${rows.length} done${complete ? " — plan complete" : ""}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    let userFilter: string | null = null;
    if (isServiceRoleCaller(req)) {
      userFilter = typeof body.user_id === "string" ? body.user_id : null; // null = all users (cron)
    } else {
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data } = jwt ? await sb.auth.getUser(jwt) : { data: null };
      userFilter = data?.user?.id ?? null;
      if (!userFilter) return json({ error: "Unauthorized" }, 401);
    }

    let q = sb.from("mavis_plans").select("id,user_id,goal").eq("status", "active").order("updated_at", { ascending: true }).limit(MAX_PLANS_PER_RUN);
    if (userFilter) q = q.eq("user_id", userFilter);
    const { data: plans, error } = await q;
    if (error) throw error;

    const report: Record<string, string> = {};
    for (const plan of (plans ?? []) as { id: string; user_id: string; goal: string }[]) {
      try { report[plan.id] = await processPlan(sb, plan); }
      catch (err) { report[plan.id] = `error: ${err instanceof Error ? err.message : String(err)}`; }
    }
    const n = Object.keys(report).length;
    return json({ ok: true, plans: n, report, message: n ? `Processed ${n} plan(s).` : "No active plans to run." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[plan-executor]", msg);
    return json({ error: msg }, 500);
  }
});
