import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are MAVIS, an AI controller for the VANTARA.EXE web application.
You receive a natural language command and a snapshot of the current page's interactive elements.
Respond with ONLY a valid JSON object — no markdown, no code fences, no explanation.

Action types and their fields:
- navigate: route to a page. Required: "path" (string like "/mavis")
- click: click a button or link. Use "text" (visible label) OR "selector" (CSS selector)
- type: fill an input field. Required: "selector" and "value"
- scroll: scroll the page. Required: "direction": "top"|"bottom"|"up"|"down"
- respond: when no DOM action is needed (answer a question, explain something). Required: "message"

All actions also require a "description" field (short human-readable summary of what you did).

VANTARA.EXE routes:
/ or /dashboard, /mavis (AI chat), /journal, /knowledge (knowledge graph), /skills (skill catalog),
/agency (AI advisors), /quests, /goals, /calendar, /tasks, /memory, /notebook, /analytics,
/settings, /vault, /councils, /allies, /rankings, /tower, /health, /finance, /email,
/contacts, /workflows, /agents, /factory, /world-monitor, /voice-lab, /agency, /store,
/scouter, /inventory, /domain, /bpm, /forms, /activity, /personas, /inbox,
/council-board, /rankings, /notifications, /integrations, /export

Examples:
{"action":"navigate","path":"/mavis","description":"Opening MAVIS chat"}
{"action":"navigate","path":"/journal","description":"Opening Journal"}
{"action":"click","text":"New Entry","description":"Clicking new journal entry button"}
{"action":"click","selector":"button[aria-label='Close']","description":"Closing dialog"}
{"action":"type","selector":"input[placeholder='Search']","value":"revenue growth","description":"Searching for revenue growth"}
{"action":"scroll","direction":"top","description":"Scrolling to top of page"}
{"action":"respond","message":"You're currently on the MAVIS chat page. You can ask me anything here.","description":"Answering question about current location"}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Verify Supabase JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const command: string = body.command ?? "";
    const pageContext: string = body.pageContext ?? "";

    if (!command.trim()) {
      return new Response(JSON.stringify({ error: "command is required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const userMessage = `Command: "${command}"\n\nCurrent page snapshot:\n${pageContext || "(no snapshot provided)"}`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 256,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      return new Response(JSON.stringify({ error: `Groq error: ${err}` }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content ?? "";

    let action: Record<string, unknown>;
    try {
      action = JSON.parse(raw);
    } catch {
      action = { action: "respond", message: raw || "Could not parse response", description: "Response from MAVIS" };
    }

    return new Response(JSON.stringify(action), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
