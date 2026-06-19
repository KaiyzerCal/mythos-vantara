// mavis-orchestrator
// Multi-agent coordinator: decomposes a complex goal into parallel sub-tasks,
// fans them out to specialized MAVIS functions simultaneously, and synthesizes
// a unified result. Enables true parallel execution across the agent network.
//
// Actions: run | plan_only

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_SRK     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHRO_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// Registry of callable functions + their purpose (fed to Claude for planning)
const AGENT_REGISTRY = {
  "mavis-google-agent":      "Google Calendar, Gmail, Drive — create events, send emails, manage files",
  "mavis-slack-agent":       "Slack — send messages, read channels, post to team",
  "mavis-notion-agent":      "Notion — create/query pages and databases",
  "mavis-airtable-agent":    "Airtable — read/write records in any base",
  "mavis-exa-agent":         "Exa semantic search — find relevant web content by meaning",
  "mavis-firecrawl-agent":   "Firecrawl — deep-scrape entire websites or specific pages",
  "mavis-youtube-agent":     "YouTube — search videos, get transcripts",
  "mavis-sec-agent":         "SEC EDGAR — company filings, financial data",
  "mavis-crm-agent":         "HubSpot CRM — contacts, deals, notes, pipeline",
  "mavis-beehiiv-agent":     "Beehiiv newsletter — create posts, manage subscribers",
  "mavis-linear-agent":      "Linear — create/update issues and projects",
  "mavis-webhook-dispatcher":"Generic outbound webhooks to any URL",
  "mavis-deep-research":     "Deep multi-source research with citations",
  "mavis-nora-post":         "Post to Twitter/X as Nora Vale",
  "mavis-email-send":        "Send email via Resend",
  "mavis-twilio-agent":      "SMS / WhatsApp messaging",
  "mavis-image-gen":         "AI image generation",
  "mavis-pdf-gen":           "Generate PDF documents",
};

async function callClaude(system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHRO_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const d = await res.json();
  return d.content?.[0]?.text ?? "";
}

async function callFunction(name: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SB_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SB_SRK}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return res.json().catch(() => ({ error: `${name} returned ${res.status}` }));
}

interface SubTask {
  id: string;
  function: string;
  description: string;
  params: Record<string, unknown>;
  depends_on?: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${SB_SRK}` && !authHeader.startsWith("Bearer eyJ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body   = await req.json().catch(() => ({}));
    const action = String(body.action ?? "run");
    const goal   = String(body.goal ?? "");
    const userId = String(body.userId ?? body.user_id ?? "");
    const ctx    = body.context ? String(body.context) : "";

    if (!goal) return json({ error: "goal required" }, 400);

    // ── PLAN ─────────────────────────────────────────────────────────────────
    const planRaw = await callClaude(
      `You are the MAVIS orchestrator. Given a goal, decompose it into parallel sub-tasks,
assign each to the best available function, and produce an execution plan.

Available functions:
${Object.entries(AGENT_REGISTRY).map(([fn, desc]) => `  ${fn}: ${desc}`).join("\n")}

Output ONLY a JSON array of sub-tasks (no markdown):
[
  {
    "id": "t1",
    "function": "mavis-exa-agent",
    "description": "what this task does",
    "params": { "action": "search", "query": "...", "userId": "${userId}" },
    "depends_on": []
  }
]

Rules:
- Max 6 sub-tasks
- Tasks with no depends_on run in parallel
- depends_on lists task IDs that must complete first
- Always include userId in params if provided
- Only use functions from the registry above`,
      `GOAL: ${goal}${ctx ? `\nCONTEXT: ${ctx}` : ""}`
    );

    let plan: SubTask[] = [];
    try {
      const m = planRaw.match(/\[[\s\S]*\]/);
      if (m) plan = JSON.parse(m[0]);
    } catch {
      return json({ error: "Plan parsing failed", raw: planRaw }, 500);
    }

    if (action === "plan_only") return json({ plan });

    // ── EXECUTE ───────────────────────────────────────────────────────────────
    const results: Record<string, unknown> = {};
    const completed = new Set<string>();

    // Execute in waves based on dependencies
    const maxWaves = 4;
    for (let wave = 0; wave < maxWaves && completed.size < plan.length; wave++) {
      const ready = plan.filter(t =>
        !completed.has(t.id) &&
        (t.depends_on ?? []).every(dep => completed.has(dep))
      );
      if (!ready.length) break;

      const waveResults = await Promise.allSettled(
        ready.map(task => callFunction(task.function, task.params))
      );

      ready.forEach((task, i) => {
        const r = waveResults[i];
        results[task.id] = r.status === "fulfilled" ? r.value : { error: String((r as any).reason) };
        completed.add(task.id);
      });
    }

    // ── SYNTHESIZE ────────────────────────────────────────────────────────────
    const synthesis = await callClaude(
      "You are MAVIS synthesizing the results of a multi-agent execution. Produce a clear, concise summary of what was accomplished and the key findings or outputs. Be direct and fact-based.",
      `ORIGINAL GOAL: ${goal}

EXECUTION RESULTS:
${plan.map(t => `[${t.id}] ${t.description}:\n${JSON.stringify(results[t.id], null, 2).slice(0, 500)}`).join("\n\n")}`
    );

    return json({ goal, plan, results, synthesis, tasks_executed: completed.size });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mavis-orchestrator]", message);
    return json({ error: message }, 500);
  }
});
