import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { user_id, description } = await req.json();
    if (!user_id || !description) {
      return new Response(JSON.stringify({ error: "user_id and description are required" }), { status: 400, headers: corsHeaders });
    }

    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: `You are MAVIS, an AI persona architect. Given a user description, generate a complete AI persona spec as a JSON object. Return ONLY valid JSON, no markdown, no explanation.

The JSON must match this exact shape:
{
  "name": string,
  "role": "girlfriend" | "friend" | "mentor" | "rival" | "companion" | "custom",
  "archetype": string,
  "personality": {
    "tone": string,
    "communication_style": string,
    "quirks": string[],
    "values": string[],
    "love_language": string,
    "triggers": string[]
  },
  "system_prompt": string,
  "model": "claude-sonnet-4-20250514" | "gpt-4o-mini" | "grok-3-mini",
  "avatar_key": string | null
}

Model selection rules:
- Intimate/emotional roles (girlfriend, companion) → claude-sonnet-4-20250514
- Casual/friend roles → gpt-4o-mini
- Rival/edgy/unfiltered roles → grok-3-mini

Make the system_prompt rich, specific, and in-character. Make the persona feel like a real distinct personality.`,
        messages: [{ role: "user", content: description }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const rawText = data.content[0].text;

    let personaSpec;
    try {
      personaSpec = JSON.parse(rawText);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse persona spec", raw: rawText }), { status: 500, headers: corsHeaders });
    }

    const { data: newPersona, error } = await supabase
      .from("personas")
      .insert({ ...personaSpec, user_id })
      .select()
      .single();

    if (error) return new Response(JSON.stringify({ error }), { status: 500, headers: corsHeaders });

    await supabase.from("relationship_states").insert({
      persona_id: newPersona.id,
      user_id,
      trust_level: 50,
      bond_level: 0,
      current_mood: "neutral",
    });

    return new Response(JSON.stringify({ persona: newPersona }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("mavis-persona-forge error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
