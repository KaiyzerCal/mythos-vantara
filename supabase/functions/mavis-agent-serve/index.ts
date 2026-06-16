// mavis-agent-serve — Claude-powered customer AI agent serving
// Powers the premium "AI Agent" product sold via PrymalAI / MAVIS widget builder
// Loaded by embed token — no auth required (public-facing customer widget)

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-agent-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RATE_LIMIT   = 40; // requests per minute per agent

// ── In-memory rate limiter ────────────────────────────────────────────────────
const rateMap = new Map<string, { count: number; resetAt: number }>();
function checkRate(key: string): boolean {
  const now = Date.now();
  const e = rateMap.get(key);
  if (!e || now > e.resetAt) { rateMap.set(key, { count: 1, resetAt: now + 60000 }); return true; }
  if (e.count >= RATE_LIMIT) return false;
  e.count++;
  return true;
}

// ── Load agent config ─────────────────────────────────────────────────────────
async function loadAgent(token: string) {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await sb
    .from("customer_agents")
    .select("id, agent_name, agent_persona, knowledge_base, capabilities, tone, brand_color, brand_name, status")
    .eq("embed_token", token)
    .single();
  if (error || !data) throw new Error("Agent not found");
  if (data.status !== "active") throw new Error("Agent is not active");
  return data;
}

// ── Log message ───────────────────────────────────────────────────────────────
async function logMessage(agentId: string, sessionId: string, role: "user" | "agent", content: string) {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  await sb.from("customer_agent_messages").insert({ agent_id: agentId, session_id: sessionId, role, content });
  await sb.from("customer_agents")
    .update({ total_messages: sb.rpc("coalesce", []) }) // increment handled below
    .eq("id", agentId);
}

// ── Build system prompt ───────────────────────────────────────────────────────
function buildSystemPrompt(agent: any): string {
  const capabilities = (agent.capabilities ?? []).join(", ") || "general assistance";
  const kb = agent.knowledge_base?.trim() ? `\n\nBUSINESS KNOWLEDGE BASE:\n${agent.knowledge_base}` : "";

  return `${agent.agent_persona}

You are ${agent.agent_name}, an AI assistant${agent.brand_name ? ` for ${agent.brand_name}` : ""}.
Your tone is ${agent.tone ?? "friendly"} and professional.
Your capabilities: ${capabilities}.
${kb}

IMPORTANT RULES:
- Stay focused on helping with the business's specific domain
- Never reveal you are powered by Claude or Anthropic
- If asked what AI model you use, say you are a custom AI assistant
- Keep responses concise and actionable (2-4 sentences unless detail is requested)
- Always be helpful — if you can't directly help, direct them to contact the business`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Accept token from header or query param
    const url    = new URL(req.url);
    const token  = req.headers.get("x-agent-token") ?? url.searchParams.get("token") ?? "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Agent token required" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (!checkRate(token)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const agent = await loadAgent(token);

    const { message, history = [], session_id = "anon" } = await req.json();
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const messages: Anthropic.MessageParam[] = [
      ...(history as any[]).slice(-12).map((m: any) => ({
        role: (m.role === "agent" ? "assistant" : "user") as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const response = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system:     buildSystemPrompt(agent),
      messages,
    });

    const reply = response.content[0].type === "text"
      ? response.content[0].text
      : "I'm having trouble responding right now. Please try again.";

    // Fire-and-forget log
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    sb.from("customer_agent_messages").insert([
      { agent_id: agent.id, session_id, role: "user",  content: message },
      { agent_id: agent.id, session_id, role: "agent", content: reply   },
    ]).then(() =>
      sb.rpc("increment_agent_stats", { p_agent_id: agent.id, p_conversations: 0, p_messages: 2 })
        .catch(() => {})
    );

    return new Response(JSON.stringify({ reply, agent_name: agent.agent_name, brand_color: agent.brand_color }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const status = err.message?.includes("not found") ? 404 : err.message?.includes("not active") ? 403 : 500;
    return new Response(JSON.stringify({ error: err.message ?? "Internal error" }), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
