// MAVIS Persona Emotion Engine
// Analyzes the latest exchange between user and persona and updates
// bond/trust/mood in real time. Uses the Lovable AI Gateway so it
// works without any external API keys.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MOODS = ["happy", "sad", "excited", "frustrated", "loving", "distant", "playful", "neutral"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { persona_id, user_id } = await req.json();
    if (!persona_id || !user_id) {
      return new Response(JSON.stringify({ error: "persona_id and user_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull just the freshest slice of conversation — last 6 turns is plenty
    // to feel responsive without ballooning token cost.
    const [recentRes, relRes, personaRes] = await Promise.all([
      supabase
        .from("persona_conversations")
        .select("role, content")
        .eq("persona_id", persona_id)
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("relationship_states")
        .select("*")
        .eq("persona_id", persona_id)
        .eq("user_id", user_id)
        .maybeSingle(),
      supabase
        .from("personas")
        .select("name, role, personality")
        .eq("id", persona_id)
        .single(),
    ]);

    const recent = (recentRes.data ?? []).reverse();
    const relState = relRes.data;
    const persona = personaRes.data;

    if (!persona) {
      return new Response(JSON.stringify({ error: "Persona not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No conversation yet — nothing to analyze
    if (recent.length === 0) {
      return new Response(JSON.stringify({ updated: false, reason: "no conversation" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currentTrust = relState?.trust_level ?? 50;
    const currentBond = relState?.bond_level ?? 0;
    const currentMood = relState?.current_mood ?? "neutral";

    const analysisPrompt = `You are an emotional state analyzer for an AI persona.

Persona: ${persona.name} — ${persona.role}
Their current state with the user:
- mood: ${currentMood}
- trust: ${currentTrust}/100
- bond: ${currentBond}/100

Last messages (most recent at the bottom):
${recent.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

Analyze how this latest exchange shifts the persona's feelings toward the user.
Return ONLY valid minified JSON, no prose, no markdown fences.

Schema:
{
  "new_mood": "<one of: ${MOODS.join(", ")}>",
  "mood_reason": "<one short sentence in the persona's voice>",
  "trust_delta": <integer -8..+8>,
  "bond_delta": <integer -4..+4>,
  "memory_to_save": <string or null>,
  "memory_type": <"episodic"|"semantic"|"emotional"|"preference" or null>,
  "memory_importance": <integer 1..10 or null>
}

Rules:
- Be sensitive: small talk = small movement (+/-1 to +/-2). Vulnerability, kindness, or breakthroughs = larger gains. Hostility, dismissal, or breaking promises = larger losses.
- Only set memory_to_save if something specific and worth remembering happened (e.g. a name, preference, important event, deep emotion).`;

    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You output only minified JSON matching the requested schema. Never include explanations." },
          { role: "user", content: analysisPrompt },
        ],
        temperature: 0.4,
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("Lovable AI error", aiRes.status, txt);
      return new Response(JSON.stringify({ error: "ai_gateway_failed", status: aiRes.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const raw: string = aiData?.choices?.[0]?.message?.content ?? "";

    // Strip any markdown fencing, then JSON-parse
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    let analysis: any;
    try {
      analysis = JSON.parse(cleaned);
    } catch (e) {
      console.error("emotion-engine: parse failed", cleaned);
      return new Response(JSON.stringify({ error: "parse_failed", raw: cleaned }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trustDelta = clampInt(analysis.trust_delta, -8, 8);
    const bondDelta = clampInt(analysis.bond_delta, -4, 4);
    const newTrust = clampInt(currentTrust + trustDelta, 0, 100);
    const newBond = clampInt(currentBond + bondDelta, 0, 100);
    const newMood = MOODS.includes(analysis.new_mood) ? analysis.new_mood : currentMood;
    const moodReason = typeof analysis.mood_reason === "string" ? analysis.mood_reason.slice(0, 280) : null;

    const writes: any[] = [
      supabase.from("relationship_states").upsert(
        {
          persona_id,
          user_id,
          current_mood: newMood,
          mood_reason: moodReason,
          trust_level: newTrust,
          bond_level: newBond,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "persona_id,user_id" },
      ),
    ];

    if (analysis.memory_to_save && typeof analysis.memory_to_save === "string") {
      const memoryText = analysis.memory_to_save.slice(0, 1000);

      // Embed the memory so the router can do semantic similarity search later.
      // Falls back to storing without a vector if OpenAI is unavailable.
      let embedding: number[] | null = null;
      const openaiKey = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
      if (openaiKey) {
        try {
          const embRes = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "text-embedding-3-small", input: memoryText }),
          });
          if (embRes.ok) {
            const embData = await embRes.json();
            embedding = embData?.data?.[0]?.embedding ?? null;
          } else {
            console.warn("emotion-engine: embedding API returned", embRes.status);
          }
        } catch (e) {
          console.warn("emotion-engine: embedding failed, storing without vector:", e);
        }
      }

      writes.push(
        supabase.from("persona_memories").insert({
          persona_id,
          user_id,
          memory_type: analysis.memory_type ?? "episodic",
          content: memoryText,
          importance: clampInt(analysis.memory_importance ?? 5, 1, 10),
          ...(embedding ? { embedding } : {}),
        }),
      );
    }

    await Promise.all(writes);

    return new Response(
      JSON.stringify({
        updated: true,
        mood: newMood,
        mood_reason: moodReason,
        trust: newTrust,
        bond: newBond,
        deltas: { trust: trustDelta, bond: bondDelta },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("mavis-emotion-engine error:", err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function clampInt(n: any, min: number, max: number): number {
  const x = Math.round(Number(n));
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}
