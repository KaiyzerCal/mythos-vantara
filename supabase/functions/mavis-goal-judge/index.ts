// mavis-goal-judge
// Ralph loop implementation: after each goal execution step, a judge AI evaluates
// {"done": true/false, "reason": "..."}. Continuation prompt auto-fed if not done.
// Max 20 turns (DEFAULT_MAX_TURNS). Fail-open (broken judge = CONTINUE).
// Cron mode reviews all active goals and runs next step if needed.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { callWithFallback } from "../_shared/providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_JUDGE_MAX_TOKENS = 512;

const JUDGE_SYSTEM_PROMPT = `You are a goal completion judge. Your only job is to evaluate whether a goal has been achieved based on the latest AI response.

Be strict but fair. Mark done=true only when the objective is genuinely complete, not just planned.
Mark done=false if the response describes a plan, proposes next steps, or indicates work is still needed.

Respond with ONLY valid JSON: {"done": boolean, "reason": "one clear sentence"}`;

const CONTINUATION_PROMPT_TEMPLATE = `The goal is not yet complete. Continue working toward it.

Goal: {objective}
Progress so far: {progress_summary}
Previous step result: {last_response}

Continue. Take the next concrete action. Do not re-state the goal — execute.`;

async function callAI(
  systemPrompt: string,
  userContent: string,
  keys: { gemini: string; claude: string; openai: string; grok: string; groq: string },
  _maxTokens = 512,
): Promise<string> {
  try {
    return (await callWithFallback("claude", [{ role: "user", content: userContent }], systemPrompt, keys)).content;
  } catch {
    return "";
  }
}

function judgeIsDone(judgeResponse: string): { done: boolean; reason: string } {
  try {
    const jsonMatch = judgeResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { done: Boolean(parsed.done), reason: String(parsed.reason ?? "") };
    }
  } catch { /* fail-open */ }
  // Fail-open: broken judge = CONTINUE
  return { done: false, reason: "Judge parse error — continuing (fail-open)" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey   = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_AI_API_KEY") ?? "";
  const claudeKey   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const openaiKey   = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
  const grokKey     = Deno.env.get("GROK_API_KEY") ?? Deno.env.get("XAI_API_KEY") ?? "";
  const groqKey     = Deno.env.get("GROQ_API_KEY") ?? "";

  const keys = { gemini: geminiKey, claude: claudeKey, openai: openaiKey, grok: grokKey, groq: groqKey };
  const sb = createClient(supabaseUrl, serviceKey);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }

  // Single-goal judge evaluation (called from mavis-chat or mavis-goal-engine)
  if (body.goal_id && body.ai_response && body.user_id) {
    const { goal_id, ai_response, user_id } = body;
    const objective = body.objective ?? "";
    const turnNumber = body.turn_number ?? 1;
    const maxTurns = body.max_turns ?? DEFAULT_MAX_TURNS;

    // Get current turn count from judge log
    const { count } = await sb
      .from("mavis_goal_judge_log")
      .select("id", { count: "exact", head: true })
      .eq("goal_id", goal_id)
      .eq("user_id", user_id);

    const turnsUsed = (count ?? 0) + 1;

    // Hard stop at max turns
    if (turnsUsed > maxTurns) {
      await sb.from("mavis_goal_judge_log").insert({
        user_id, goal_id, goal_objective: objective,
        turn_number: turnsUsed,
        judge_verdict: true, // force done
        judge_reason: `Max turns (${maxTurns}) reached — goal marked complete`,
        ai_response: ai_response.slice(0, 2000),
      });
      return new Response(JSON.stringify({ done: true, reason: `Max turns reached (${maxTurns})`, turns_used: turnsUsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Run judge evaluation
    const judgeInput = `Goal: ${objective}\n\nLatest AI response:\n${ai_response.slice(0, 2000)}`;
    const judgeRaw = await callAI(JUDGE_SYSTEM_PROMPT, judgeInput, keys, DEFAULT_JUDGE_MAX_TOKENS);
    const { done, reason } = judgeIsDone(judgeRaw);

    // Build continuation prompt if not done
    let continuationPrompt = "";
    if (!done) {
      // Get a progress summary from previous turns
      const { data: prevLogs } = await sb
        .from("mavis_goal_judge_log")
        .select("judge_reason, ai_response")
        .eq("goal_id", goal_id)
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(3);

      const progressSummary = (prevLogs ?? [])
        .map((l: any) => `• ${l.judge_reason}`)
        .join("\n") || "Starting";

      continuationPrompt = CONTINUATION_PROMPT_TEMPLATE
        .replace("{objective}", objective)
        .replace("{progress_summary}", progressSummary)
        .replace("{last_response}", ai_response.slice(0, 500));
    }

    // Log the judge decision
    await sb.from("mavis_goal_judge_log").insert({
      user_id, goal_id, goal_objective: objective,
      turn_number: turnsUsed,
      judge_verdict: done,
      judge_reason: reason,
      continuation_prompt: continuationPrompt.slice(0, 2000),
      ai_response: ai_response.slice(0, 2000),
      max_turns: maxTurns,
    });

    // If done, update goal status to completed
    if (done) {
      await sb.from("mavis_goals")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", goal_id)
        .eq("user_id", user_id);
    }

    return new Response(JSON.stringify({ done, reason, continuation_prompt: continuationPrompt, turns_used: turnsUsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cron mode: review all active goals, check for stalled ones
  if (body.trigger === "cron" || body.mode === "review_active") {
    const { data: activeGoals } = await sb
      .from("mavis_goals")
      .select("id, user_id, objective, status, created_at")
      .in("status", ["active", "decomposed"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (!activeGoals?.length) {
      return new Response(JSON.stringify({ reviewed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let reviewed = 0;
    for (const goal of activeGoals as any[]) {
      try {
        // Check turn count
        const { count } = await sb
          .from("mavis_goal_judge_log")
          .select("id", { count: "exact", head: true })
          .eq("goal_id", goal.id);

        const turnsUsed = count ?? 0;

        if (turnsUsed >= DEFAULT_MAX_TURNS) {
          // Max turns exceeded — mark complete
          await sb.from("mavis_goals")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("id", goal.id);
          reviewed++;
        }
      } catch { /* non-fatal */ }
    }

    return new Response(JSON.stringify({ reviewed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Missing required fields: goal_id, ai_response, user_id" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
