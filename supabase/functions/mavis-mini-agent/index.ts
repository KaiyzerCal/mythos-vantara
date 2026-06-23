// mavis-mini-agent — personal-use AI agent for MAVIS operators
// BOUND_OPERATORS gate: only Calvin & Caliyah can use this
// Routes to Google, Social, or General agent logic

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

// ── BOUND_OPERATORS gate ──────────────────────────────────────────────────────
const MAVIS_OPERATOR_MAIN_ID    = Deno.env.get("MAVIS_OPERATOR_MAIN_ID")    ?? "";
const MAVIS_OPERATOR_CALIYAH_ID = Deno.env.get("MAVIS_OPERATOR_CALIYAH_ID") ?? "";
const BOUND_OPERATORS = new Set([MAVIS_OPERATOR_MAIN_ID, MAVIS_OPERATOR_CALIYAH_ID].filter(Boolean));

// ── Agent system prompts ──────────────────────────────────────────────────────
const AGENT_PROMPTS: Record<string, string> = {
  google: `You are a Google Workspace AI agent for MAVIS operators.
You help manage Gmail, Google Calendar, Google Drive, Docs, Sheets, Tasks, and Contacts.
When responding, describe your actions step by step.
Format replies as JSON: { "reply": string, "steps": [{ "label": string, "detail"?: string }] }
Be concise and action-oriented. If accounts aren't connected, guide the user to connect them.`,

  social: `You are a Social Media AI agent for MAVIS operators.
You help with Instagram, X/Twitter, LinkedIn, Facebook — writing content, drafting posts, captions, scheduling strategy.
When responding, describe your actions step by step.
Format replies as JSON: { "reply": string, "steps": [{ "label": string, "detail"?: string }] }
Write in the user's voice. Match each platform's style and best practices.`,

  general: `You are a personal AI agent within MAVIS.
You help with a wide range of tasks: research, drafting, planning, analysis, brainstorming.
When responding, describe your actions step by step.
Format replies as JSON: { "reply": string, "steps": [{ "label": string, "detail"?: string }] }
Be thorough yet concise.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Auth check
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // BOUND_OPERATORS gate
    if (!BOUND_OPERATORS.has(user.id)) {
      return new Response(JSON.stringify({ error: "Access restricted to MAVIS operators" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const { agent_type = "general", message, history = [] } = await req.json();
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "message required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const systemPrompt = AGENT_PROMPTS[agent_type] ?? AGENT_PROMPTS.general;

    const messages: Anthropic.MessageParam[] = [
      ...(history as any[]).slice(-16).map((m: any) => ({
        role: (m.role === "agent" ? "assistant" : "user") as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const response = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system:     systemPrompt,
      messages,
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text : "";

    let payload: { reply: string; steps: { label: string; detail?: string }[] };
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      payload = match ? JSON.parse(match[0]) : { reply: rawText, steps: [] };
    } catch {
      payload = { reply: rawText, steps: [] };
    }

    return new Response(JSON.stringify(payload), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "Internal error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
