import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_KEY  = Deno.env.get("GEMINI_API_KEY") ?? "";
const CLAUDE_KEY  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const PLAN_SYSTEM = `You are MAVIS's strategic planner. Given a high-level goal, decompose it into a concrete DAG of executable steps. Each step must be actionable, specific, and completable within one focused work session.

Step types:
- research: Gather information or do web research
- write: Produce written content (copy, code, docs)
- execute: Take a real-world action (send email, post, publish)
- create_quest: Create a MAVIS quest/task for manual work
- notify: Send a notification or summary to the operator
- wait: Pause pending an external event (operator review, deadline)

Return ONLY valid JSON — no markdown, no explanation:
{
  "title": "short plan title",
  "steps": [
    {
      "step_index": 0,
      "title": "step title",
      "description": "what exactly to do",
      "type": "research|write|execute|create_quest|notify|wait",
      "depends_on_indices": [],
      "actions": []
    }
  ]
}`;

async function callPlannerLLM(goal: string, context: string): Promise<{ title: string; steps: any[] }> {
  const userMsg = `GOAL: ${goal}\n\nCONTEXT: ${context.slice(0, 2000)}\n\nCreate a complete execution plan.`;

  // Try Gemini 2.5 Flash with thinking for best planning quality
  if (GEMINI_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: PLAN_SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: userMsg }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 4096 },
          },
        }),
      }
    );
    if (res.ok) {
      const d = await res.json();
      const parts: any[] = d?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter((p: any) => !p.thought).map((p: any) => p.text).join("");
      if (text) return JSON.parse(text);
    }
  }

  // Fallback: Claude Sonnet
  if (CLAUDE_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: PLAN_SYSTEM,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (res.ok) {
      const d = await res.json();
      const text = d.content?.[0]?.text ?? "";
      const match = text.match(/\{[\s\S]+\}/);
      if (match) return JSON.parse(match[0]);
    }
  }

  throw new Error("No planner LLM available");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const userClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { goal, context = "" } = await req.json();
    if (!goal?.trim()) {
      return new Response(JSON.stringify({ error: "goal is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate plan DAG
    const plan = await callPlannerLLM(goal, context);

    // Persist plan to DB
    const { data: planRow, error: planErr } = await sb.from("mavis_plans").insert({
      user_id: user.id,
      title: plan.title ?? goal.slice(0, 80),
      goal,
      status: "active",
      total_steps: plan.steps.length,
      context: { goal, context: context.slice(0, 500) },
    }).select("id").single();

    if (planErr || !planRow) throw new Error(`Failed to create plan: ${planErr?.message}`);

    // Persist steps
    const stepRows = plan.steps.map((s: any) => ({
      plan_id: planRow.id,
      user_id: user.id,
      step_index: s.step_index ?? 0,
      title: String(s.title ?? "").slice(0, 200),
      description: String(s.description ?? "").slice(0, 1000),
      type: s.type ?? "execute",
      status: "pending",
      depends_on: [],
      actions: s.actions ?? [],
    }));

    const { error: stepsErr } = await sb.from("mavis_plan_steps").insert(stepRows);
    if (stepsErr) console.warn("Steps insert error:", stepsErr.message);

    return new Response(JSON.stringify({
      plan_id: planRow.id,
      title: plan.title,
      total_steps: plan.steps.length,
      steps: stepRows.map(s => ({ title: s.title, type: s.type, status: s.status })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("mavis-planner error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
