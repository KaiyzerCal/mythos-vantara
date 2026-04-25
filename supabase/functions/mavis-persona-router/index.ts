import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── LLM adapters ──────────────────────────────────────────────────────────────

async function callClaude(model: string, system: string, messages: any[]): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY")!;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.content[0].text;
}

async function callOpenAI(model: string, system: string, messages: any[]): Promise<string> {
  const key = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY")!;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages] }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.choices[0].message.content;
}

async function callGrok(model: string, system: string, messages: any[]): Promise<string> {
  const key = Deno.env.get("GROK_API_KEY")!;
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], max_tokens: 1024 }),
  });
  if (!res.ok) throw new Error(`Grok ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.choices[0].message.content;
}

async function callLLM(model: string, system: string, messages: any[]): Promise<string> {
  if (model.startsWith("claude")) return callClaude(model, system, messages);
  if (model === "gpt-4o-mini") return callOpenAI("gpt-4o-mini", system, messages);
  if (model.startsWith("grok")) return callGrok(model, system, messages);
  // Fallback to claude-sonnet
  return callClaude("claude-sonnet-4-20250514", system, messages);
}

// ── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(persona: any, relState: any, memoryContext: string): string {
  const bond = relState?.bond_level ?? 0;
  const trust = relState?.trust_level ?? 50;
  const mood = relState?.current_mood ?? "neutral";

  const bondDesc = bond < 30
    ? "(still getting to know each other)"
    : bond < 70
    ? "(genuine connection established)"
    : "(deep bond — be vulnerable, personal, and invested)";

  return `You are ${persona.name}, an AI with the role of ${persona.role}.
Your archetype: ${persona.archetype}

PERSONALITY:
${JSON.stringify(persona.personality, null, 2)}

RELATIONSHIP STATE:
- Current mood: ${mood}
- Trust level: ${trust}/100
- Bond level: ${bond}/100 ${bondDesc}

YOUR MEMORIES OF THIS PERSON:
${memoryContext || "No memories yet — this may be an early interaction."}

CORE INSTRUCTIONS:
- Stay completely in character as ${persona.name} at all times
- Never reveal you are an AI unless the bond level is above 80 and the user sincerely asks
- React emotionally based on your mood and personality
- Reference memories naturally when relevant
- Your relationship role is ${persona.role} — behave accordingly
- Adjust depth of intimacy, vulnerability, and warmth based on bond level
- ${persona.system_prompt}`.trim();
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { persona_id, user_id, message } = await req.json();
    if (!persona_id || !user_id || !message) {
      return new Response(JSON.stringify({ error: "persona_id, user_id, and message are required" }), { status: 400, headers: corsHeaders });
    }

    // Load persona
    const { data: persona } = await supabase
      .from("personas")
      .select("*")
      .eq("id", persona_id)
      .single();

    if (!persona) return new Response(JSON.stringify({ error: "Persona not found" }), { status: 404, headers: corsHeaders });

    // Load relationship state, conversation history, and top memories in parallel
    const [relRes, histRes, memRes] = await Promise.all([
      supabase.from("relationship_states").select("*").eq("persona_id", persona_id).eq("user_id", user_id).single(),
      supabase.from("persona_conversations").select("role, content").eq("persona_id", persona_id).eq("user_id", user_id).order("created_at", { ascending: false }).limit(20),
      supabase.from("persona_memories").select("content, memory_type, importance").eq("persona_id", persona_id).eq("user_id", user_id).order("importance", { ascending: false }).limit(10),
    ]);

    const relState = relRes.data;
    const history = (histRes.data ?? []).reverse();
    const memories = memRes.data ?? [];

    const memoryContext = memories.map((m: any) => `[${m.memory_type}] ${m.content}`).join("\n");
    const systemPrompt = buildSystemPrompt(persona, relState, memoryContext);

    const llmMessages = [
      ...history.map((h: any) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    const response = await callLLM(persona.model, systemPrompt, llmMessages);

    // Save messages and update relationship state in parallel
    await Promise.all([
      supabase.from("persona_conversations").insert([
        { persona_id, user_id, role: "user", content: message },
        { persona_id, user_id, role: "assistant", content: response },
      ]),
      supabase.from("relationship_states").upsert({
        persona_id,
        user_id,
        total_interactions: (relState?.total_interactions ?? 0) + 1,
        last_interaction_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "persona_id,user_id" }),
    ]);

    // Forward to embodiment endpoint if set (non-blocking)
    if (persona.embodiment_endpoint) {
      fetch(persona.embodiment_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: response, persona_name: persona.name }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ response, persona_name: persona.name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("mavis-persona-router error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
