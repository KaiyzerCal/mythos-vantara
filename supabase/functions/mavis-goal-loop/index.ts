// mavis-goal-loop — Manus-style autonomous task execution loop
// Given a goal, runs a think→plan→act loop until completion or max_iterations.
// Each iteration: Claude plans the next action, MAVIS executes it (search/write/
// create_task/create_memory/fetch_url), then loops with the updated context.
// Returns a full trace + final result so the UI can show progress.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const supabase  = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

interface LoopStep {
  iteration:  number;
  thought:    string;
  action:     string;
  action_args: Record<string, unknown>;
  result:     string;
  done:       boolean;
}

const SYSTEM = `You are MAVIS in autonomous GOAL-LOOP mode. You are given a goal and the results of previous steps.
Plan the single best NEXT action to make progress toward the goal.
When the goal is complete, set done=true.

Available actions:
- create_task: Create a task in the system. Args: {title, priority?, due_date?}
- add_memory: Store a fact or decision. Args: {title, content, memory_type?}
- create_journal: Write a journal note about progress. Args: {content, mood?}
- web_search: Search the web for information. Args: {query} (simulated — returns reasoning)
- analyze: Think deeply about available info to produce a plan/output. Args: {prompt}
- done: Signal completion. Args: {summary}

Respond ONLY with valid JSON (no markdown):
{
  "thought": "one sentence explaining your reasoning",
  "action": "action_name",
  "action_args": { ... },
  "done": false
}`;

async function executeAction(
  action: string,
  args: Record<string, unknown>,
  user_id: string,
): Promise<string> {
  switch (action) {
    case "create_task": {
      const { data, error } = await supabase.from("tasks").insert({
        user_id,
        title:    String(args.title ?? ""),
        priority: String(args.priority ?? "medium"),
        due_date: args.due_date ? String(args.due_date) : null,
        status:   "pending",
        source:   "mavis_goal_loop",
      }).select("id").single();
      if (error) return `Failed to create task: ${error.message}`;
      return `Task created: "${args.title}" (ID: ${data?.id})`;
    }

    case "add_memory": {
      const { data, error } = await supabase.from("memories").insert({
        user_id,
        title:       String(args.title ?? "Goal loop note"),
        content:     String(args.content ?? ""),
        memory_type: String(args.memory_type ?? "auto"),
        tags:        ["goal_loop"],
      }).select("id").single();
      if (error) return `Failed to store memory: ${error.message}`;
      return `Memory stored (ID: ${data?.id}): "${args.title}"`;
    }

    case "create_journal": {
      const { data, error } = await supabase.from("journal_entries").insert({
        user_id,
        content: String(args.content ?? ""),
        mood:    args.mood ? String(args.mood) : null,
        tags:    ["goal_loop"],
      }).select("id").single();
      if (error) return `Failed to write journal: ${error.message}`;
      return `Journal entry written (ID: ${data?.id})`;
    }

    case "web_search": {
      // Simulated web search — MAVIS reasons about the query
      const query = String(args.query ?? "");
      const res = await anthropic.messages.create({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system:     "You are a research assistant. Reason about the query from your knowledge and provide the most useful information available. Be concise and factual.",
        messages:   [{ role: "user", content: `Research: ${query}` }],
      });
      return `Search result for "${query}": ${((res.content[0] as any).text ?? "").trim()}`;
    }

    case "analyze": {
      const prompt = String(args.prompt ?? "");
      const res = await anthropic.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 800,
        system:     "You are MAVIS performing deep analysis. Be structured, decisive, and actionable.",
        messages:   [{ role: "user", content: prompt }],
      });
      return ((res.content[0] as any).text ?? "").trim();
    }

    case "done":
      return String(args.summary ?? "Goal completed.");

    default:
      return `Unknown action: ${action}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    const { goal, max_iterations = 5, context } = await req.json() as {
      goal:            string;
      max_iterations?: number;
      context?:        string;
    };

    if (!goal?.trim()) {
      return new Response(JSON.stringify({ error: "goal required" }), { status: 400, headers: CORS });
    }

    const steps: LoopStep[] = [];
    let history = `GOAL: ${goal}\n${context ? `CONTEXT: ${context}\n` : ""}`;

    for (let i = 1; i <= Math.min(max_iterations, 10); i++) {
      const res = await anthropic.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 400,
        system:     SYSTEM,
        messages:   [{ role: "user", content: history }],
      });

      const raw = ((res.content[0] as any).text ?? "").trim();
      let parsed: { thought: string; action: string; action_args: Record<string, unknown>; done: boolean };

      try {
        parsed = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/, ""));
      } catch {
        steps.push({ iteration: i, thought: "Parse failed", action: "error", action_args: {}, result: raw, done: true });
        break;
      }

      const actionResult = await executeAction(parsed.action, parsed.action_args ?? {}, user.id);

      steps.push({
        iteration:   i,
        thought:     parsed.thought,
        action:      parsed.action,
        action_args: parsed.action_args ?? {},
        result:      actionResult,
        done:        parsed.done ?? false,
      });

      history += `\n\nSTEP ${i}:\nThought: ${parsed.thought}\nAction: ${parsed.action}(${JSON.stringify(parsed.action_args)})\nResult: ${actionResult}`;

      if (parsed.done || parsed.action === "done") break;
    }

    const finalStep = steps[steps.length - 1];
    const finalResult = finalStep?.action === "done"
      ? String(finalStep.action_args?.summary ?? finalStep.result)
      : `Completed ${steps.length} steps. ${finalStep?.result ?? ""}`;

    // Store the loop run as a memory
    await supabase.from("memories").insert({
      user_id:     user.id,
      title:       `Goal loop: ${goal.slice(0, 80)}`,
      content:     `Completed in ${steps.length} steps.\n\n${finalResult}`,
      memory_type: "auto",
      tags:        ["goal_loop", "autonomous"],
    }).catch(() => {});

    return new Response(
      JSON.stringify({ goal, steps, final_result: finalResult, iterations: steps.length }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (err) {
    console.error("[mavis-goal-loop]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
