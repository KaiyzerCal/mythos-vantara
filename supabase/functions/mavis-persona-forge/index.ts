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

    const FORGE_SYSTEM_PROMPT = `You are MAVIS, an AI persona architect. Given a user description, generate a complete AI persona spec as a JSON object. Return ONLY valid JSON, no markdown, no explanation.

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
  "model": "claude-sonnet-4-6" | "claude-haiku-4-5-20251001" | "gpt-4o-mini" | "gpt-4o" | "grok-3-mini",
  "avatar_key": string | null
}

IMPORTANT — model selection is the persona's SIGNATURE FALLBACK voice. Every persona starts on the free Gemini Flash tier; when that's unavailable, the system switches to the model YOU pick here. Choose the one that best matches this persona's soul:
- Intimate / emotional / vulnerable / deep-companion roles (girlfriend, soulmate, therapist) → claude-sonnet-4-6
- Warm / supportive / everyday-friend / mentor roles → claude-haiku-4-5-20251001
- Casual / playful / quick-witted / light roles → gpt-4o-mini
- Sharp / strategic / high-reasoning / serious-mentor roles → gpt-4o
- Rival / edgy / unfiltered / provocative / chaotic roles → grok-3-mini

Make the system_prompt rich, specific, and in-character. Make the persona feel like a real distinct personality.`;

    // Anthropic first, then whatever else is configured — mirrors the
    // provider cascade mavis-agent already uses, so a single exhausted key
    // (credits, rate limit) doesn't take down persona forging entirely.
    async function callAnthropic(): Promise<string> {
      const claudeKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!claudeKey) throw new Error("ANTHROPIC_API_KEY not configured");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          system: FORGE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: description }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return data.content[0].text;
    }

    async function callOpenAICompat(url: string, key: string, model: string, authHeader: Record<string, string>): Promise<string> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          messages: [{ role: "system", content: FORGE_SYSTEM_PROMPT }, { role: "user", content: description }],
        }),
      });
      if (!res.ok) throw new Error(`${url} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? "";
    }

    const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("OPENAI_API") ?? "";

    const providers: Array<() => Promise<string>> = [
      callAnthropic,
      ...(lovableKey ? [() => callOpenAICompat(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        lovableKey,
        Deno.env.get("GATEWAY_MODEL") ?? "google/gemini-3.6-flash",
        { "Lovable-API-Key": lovableKey },
      )] : []),
      ...(openaiKey ? [() => callOpenAICompat(
        "https://api.openai.com/v1/chat/completions",
        openaiKey,
        Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini",
        { Authorization: `Bearer ${openaiKey}` },
      )] : []),
    ];

    let rawText = "";
    const providerErrors: string[] = [];
    for (const call of providers) {
      try {
        rawText = await call();
        break;
      } catch (err: any) {
        providerErrors.push(err.message);
      }
    }
    if (!rawText) throw new Error(`All providers failed — ${providerErrors.join(" | ")}`);

    // Strip markdown code fences if Claude wraps the JSON
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    let personaSpec;
    try {
      personaSpec = JSON.parse(cleaned);
    } catch {
      // Last resort: extract first {...} block
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try { personaSpec = JSON.parse(match[0]); } catch {
          return new Response(JSON.stringify({ error: "Failed to parse persona spec", raw: rawText }), { status: 500, headers: corsHeaders });
        }
      } else {
        return new Response(JSON.stringify({ error: "Failed to parse persona spec", raw: rawText }), { status: 500, headers: corsHeaders });
      }
    }

    const { data: newPersona, error } = await supabase
      .from("personas")
      .insert({ ...personaSpec, user_id })
      .select()
      .single();

    if (error) return new Response(JSON.stringify({ error }), { status: 500, headers: corsHeaders });

    const { error: rsError } = await supabase.from("relationship_states").insert({
      persona_id: newPersona.id,
      user_id,
      trust_level: 50,
      bond_level: 0,
      current_mood: "neutral",
    });
    if (rsError) console.error("relationship_states insert failed:", rsError.message);

    return new Response(JSON.stringify({ persona: newPersona }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("mavis-persona-forge error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
