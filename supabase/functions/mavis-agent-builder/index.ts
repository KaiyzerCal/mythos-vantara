// mavis-agent-builder — MAVIS generates Claude-powered customer agent configs
// Takes a business brief → generates agent persona → saves to customer_agents

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

// ── Generate agent persona via Claude ─────────────────────────────────────────
async function generatePersona(brief: {
  business_name:  string;
  business_type:  string;
  agent_name:     string;
  capabilities:   string[];
  knowledge_base: string;
  tone:           string;
}): Promise<string> {
  const capList = brief.capabilities.length
    ? brief.capabilities.map((c) => `- ${c}`).join("\n")
    : "- General assistance and Q&A";

  const prompt = `You are writing a system prompt for a custom AI agent. The agent will be embedded on a customer's website.

BUSINESS DETAILS:
- Business name: ${brief.business_name}
- Business type: ${brief.business_type || "general business"}
- Agent name: ${brief.agent_name}
- Tone: ${brief.tone}
- Capabilities:
${capList}
${brief.knowledge_base ? `\nBUSINESS KNOWLEDGE:\n${brief.knowledge_base}` : ""}

Write a complete, professional system prompt for this AI agent. The prompt should:
1. Define the agent's identity and role
2. Establish the tone and communication style
3. List what the agent can and cannot help with
4. Guide how to handle edge cases (questions outside scope, escalation)
5. Include any relevant business info from the knowledge base

Write ONLY the system prompt itself — no explanation, no preamble. Start directly with "You are..."`;

  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages:   [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text"
    ? response.content[0].text
    : `You are ${brief.agent_name}, an AI assistant for ${brief.business_name}. You are helpful, ${brief.tone}, and focused on helping customers.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Auth check
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { action = "create" } = body;

    if (action === "create") {
      const {
        customer_name, customer_email, business_name, business_type,
        agent_name, capabilities, knowledge_base, tone,
        brand_color, plan_tier, monthly_price_cents,
      } = body;

      if (!business_name?.trim()) {
        return new Response(JSON.stringify({ error: "business_name required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      }

      // Generate agent persona via Claude
      const agent_persona = await generatePersona({
        business_name:  business_name ?? "",
        business_type:  business_type ?? "",
        agent_name:     agent_name ?? "AI Assistant",
        capabilities:   capabilities ?? [],
        knowledge_base: knowledge_base ?? "",
        tone:           tone ?? "friendly",
      });

      // Save to customer_agents
      const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data, error } = await sbAdmin
        .from("customer_agents")
        .insert({
          user_id:            user.id,
          customer_name:      customer_name ?? "",
          customer_email:     customer_email ?? "",
          business_name:      business_name,
          business_type:      business_type ?? "",
          agent_name:         agent_name ?? "AI Assistant",
          agent_persona,
          capabilities:       capabilities ?? [],
          knowledge_base:     knowledge_base ?? "",
          tone:               tone ?? "friendly",
          brand_color:        brand_color ?? "#1a56db",
          plan_tier:          plan_tier ?? "widget",
          monthly_price_cents: monthly_price_cents ?? 19700,
        })
        .select("id, embed_token, agent_name, brand_color")
        .single();

      if (error) throw error;

      const agentServeUrl = `${SUPABASE_URL}/functions/v1/mavis-agent-serve`;
      const loaderUrl     = `${SUPABASE_URL}/functions/v1/prymal-widget-loader`;

      const embedSnippets = {
        html_script: `<!-- ${data.agent_name} — Powered by PrymalAI -->\n<script src="${loaderUrl}?token=${data.embed_token}" async></script>`,
        iframe:      `<iframe src="${agentServeUrl}/chat?token=${data.embed_token}" width="100%" height="600" frameborder="0" allow="microphone"></iframe>`,
        api_call:    `fetch("${agentServeUrl}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json", "x-agent-token": "${data.embed_token}" },\n  body: JSON.stringify({ message: "Hello", history: [], session_id: "user-123" })\n})`,
      };

      return new Response(JSON.stringify({ agent: data, embed_snippets: embedSnippets, agent_persona }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (action === "list") {
      const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data } = await sbAdmin
        .from("customer_agents")
        .select("id, customer_name, business_name, agent_name, brand_color, plan_tier, status, monthly_price_cents, total_conversations, total_messages, embed_token, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      return new Response(JSON.stringify({ agents: data ?? [] }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (action === "update") {
      const { agent_id, ...updates } = body;
      const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

      // If knowledge_base or capabilities changed, regenerate persona
      if (updates.knowledge_base !== undefined || updates.capabilities !== undefined || updates.tone !== undefined) {
        const { data: existing } = await sbAdmin.from("customer_agents").select("*").eq("id", agent_id).single();
        if (existing) {
          updates.agent_persona = await generatePersona({
            business_name:  updates.business_name  ?? existing.business_name,
            business_type:  updates.business_type  ?? existing.business_type,
            agent_name:     updates.agent_name     ?? existing.agent_name,
            capabilities:   updates.capabilities   ?? existing.capabilities,
            knowledge_base: updates.knowledge_base ?? existing.knowledge_base,
            tone:           updates.tone           ?? existing.tone,
          });
        }
      }

      const { error } = await sbAdmin
        .from("customer_agents")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", agent_id)
        .eq("user_id", user.id);

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      const { agent_id } = body;
      const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);
      await sbAdmin.from("customer_agents").delete().eq("id", agent_id).eq("user_id", user.id);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "Internal error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
