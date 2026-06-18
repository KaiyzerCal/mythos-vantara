// MAVIS Plans — persistent multi-session goal planning.
// Stores structured plans with ordered steps that survive across sessions.
// MAVIS injects active plans into every chat context so it always knows
// what it's working toward.
//
// Actions:
//   create_plan     — create a new plan with title, goal, and steps[]
//   get_plans       — fetch all active/paused plans
//   get_plan        — fetch a single plan by id
//   update_plan     — update title, goal, steps, current_step, status
//   advance_step    — mark current step done and move to next
//   update_session  — write last_session_summary (called after each session)
//   complete_plan   — mark plan completed
//   delete_plan     — remove a plan
//   generate_plan   — use Claude to decompose a goal into structured steps

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_SRK     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status}`);
  const d = await res.json();
  return String(d.content?.[0]?.text ?? "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { userId, action, ...p } = body as Record<string, unknown>;
    if (!userId) throw new Error("userId required");
    if (!action)  throw new Error("action required");

    const sb = createClient(SB_URL, SB_SRK, { auth: { persistSession: false } });
    let result: unknown;

    switch (action as string) {

      // ── GENERATE PLAN ──────────────────────────────────────────────────────
      // Claude decomposes a high-level goal into structured steps
      case "generate_plan": {
        const goal = String(p.goal ?? p.objective ?? "");
        if (!goal) throw new Error("goal required");
        const context = String(p.context ?? "");
        const timeframe = String(p.timeframe ?? "");

        const raw = await callClaude(
          `You are an expert life and business planning AI. Decompose a high-level goal into a clear, ordered sequence of concrete action steps. Each step should be specific, actionable, and completable in 1-7 days. Reply ONLY with valid JSON. No prose.`,
          `Goal: ${goal}${context ? `\nContext: ${context}` : ""}${timeframe ? `\nTimeframe: ${timeframe}` : ""}\n\nReturn JSON:\n{"title":"short plan title","steps":[{"step":"concrete action","notes":"optional detail","estimated_days":3}]}\n\nRules:\n- 3-12 steps\n- Each step is a clear action verb phrase\n- Order from first to last\n- Be specific to this goal`
        );

        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Claude returned no plan");
        const parsed = JSON.parse(jsonMatch[0]) as any;

        // Create the plan in DB
        const { data: planRow, error } = await sb.from("mavis_plans").insert({
          user_id:  userId,
          title:    String(parsed.title ?? goal.slice(0, 80)),
          goal:     goal,
          steps:    (parsed.steps ?? []).map((s: any) => ({ ...s, status: "pending" })),
          context:  context,
          status:   "active",
        }).select("*").single();

        if (error) throw new Error(error.message);
        result = planRow;
        break;
      }

      // ── CREATE PLAN ────────────────────────────────────────────────────────
      case "create_plan": {
        const steps = Array.isArray(p.steps) ? p.steps : [];
        const { data: planRow, error } = await sb.from("mavis_plans").insert({
          user_id:  userId,
          title:    String(p.title ?? "Untitled Plan"),
          goal:     String(p.goal ?? p.objective ?? ""),
          steps:    steps.map((s: any) => ({ step: String(s.step ?? s), status: "pending", notes: s.notes ?? "" })),
          context:  String(p.context ?? ""),
          status:   "active",
        }).select("*").single();
        if (error) throw new Error(error.message);
        result = planRow;
        break;
      }

      // ── GET PLANS ──────────────────────────────────────────────────────────
      case "get_plans": {
        const status = p.status ?? "active";
        const { data } = await sb.from("mavis_plans")
          .select("*")
          .eq("user_id", userId)
          .in("status", status === "all" ? ["active", "paused", "completed", "abandoned"] : [String(status)])
          .order("updated_at", { ascending: false });
        result = { plans: data ?? [] };
        break;
      }

      // ── GET SINGLE PLAN ────────────────────────────────────────────────────
      case "get_plan": {
        const planId = String(p.plan_id ?? "");
        if (!planId) throw new Error("plan_id required");
        const { data } = await sb.from("mavis_plans").select("*").eq("id", planId).eq("user_id", userId).maybeSingle();
        if (!data) throw new Error("Plan not found");
        result = data;
        break;
      }

      // ── UPDATE PLAN ────────────────────────────────────────────────────────
      case "update_plan": {
        const planId = String(p.plan_id ?? "");
        if (!planId) throw new Error("plan_id required");
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (p.title !== undefined) updates.title = String(p.title);
        if (p.goal !== undefined) updates.goal = String(p.goal);
        if (p.steps !== undefined) updates.steps = p.steps;
        if (p.current_step !== undefined) updates.current_step = Number(p.current_step);
        if (p.status !== undefined) updates.status = String(p.status);
        if (p.context !== undefined) updates.context = String(p.context);
        await sb.from("mavis_plans").update(updates).eq("id", planId).eq("user_id", userId);
        result = { plan_id: planId, updated: true };
        break;
      }

      // ── ADVANCE STEP ───────────────────────────────────────────────────────
      // Mark current step as done, move to next
      case "advance_step": {
        const planId = String(p.plan_id ?? "");
        if (!planId) throw new Error("plan_id required");
        const { data: plan } = await sb.from("mavis_plans").select("*").eq("id", planId).eq("user_id", userId).maybeSingle();
        if (!plan) throw new Error("Plan not found");

        const steps = Array.isArray(plan.steps) ? [...plan.steps] : [];
        const currentIdx = plan.current_step ?? 0;
        if (steps[currentIdx]) {
          steps[currentIdx] = { ...steps[currentIdx], status: "done", completed_at: new Date().toISOString(), notes: p.notes ? String(p.notes) : steps[currentIdx].notes };
        }
        const nextStep = currentIdx + 1;
        const isComplete = nextStep >= steps.length;

        await sb.from("mavis_plans").update({
          steps,
          current_step: nextStep,
          status: isComplete ? "completed" : "active",
          updated_at: new Date().toISOString(),
        }).eq("id", planId).eq("user_id", userId);

        result = {
          plan_id: planId,
          completed_step: currentIdx,
          next_step: isComplete ? null : nextStep,
          plan_complete: isComplete,
          next_action: isComplete ? "Plan completed!" : steps[nextStep]?.step,
        };
        break;
      }

      // ── UPDATE SESSION SUMMARY ─────────────────────────────────────────────
      // Called after each session to record what happened
      case "update_session": {
        const planId = String(p.plan_id ?? "");
        if (!planId) throw new Error("plan_id required");
        await sb.from("mavis_plans").update({
          last_session_summary: String(p.summary ?? "").slice(0, 1000),
          updated_at: new Date().toISOString(),
        }).eq("id", planId).eq("user_id", userId);
        result = { plan_id: planId, updated: true };
        break;
      }

      // ── COMPLETE PLAN ──────────────────────────────────────────────────────
      case "complete_plan": {
        const planId = String(p.plan_id ?? "");
        if (!planId) throw new Error("plan_id required");
        await sb.from("mavis_plans").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", planId).eq("user_id", userId);
        result = { plan_id: planId, completed: true };
        break;
      }

      // ── DELETE PLAN ────────────────────────────────────────────────────────
      case "delete_plan": {
        const planId = String(p.plan_id ?? "");
        if (!planId) throw new Error("plan_id required");
        await sb.from("mavis_plans").delete().eq("id", planId).eq("user_id", userId);
        result = { deleted: true };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
