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

    const { persona_id, user_id } = await req.json();
    if (!persona_id || !user_id) {
      return new Response(JSON.stringify({ error: "persona_id and user_id are required" }), { status: 400, headers: corsHeaders });
    }

    // Load recent conversation, relationship state, and persona in parallel
    const [recentRes, relRes, personaRes] = await Promise.all([
      supabase.from("persona_conversations").select("role, content").eq("persona_id", persona_id).eq("user_id", user_id).order("created_at", { ascending: false }).limit(10),
      supabase.from("relationship_states").select("*").eq("persona_id", persona_id).eq("user_id", user_id).single(),
      supabase.from("personas").select("name, role, personality").eq("id", persona_id).single(),
    ]);

    const recent = (recentRes.data ?? []).reverse();
    const relState = relRes.data;
    const persona = personaRes.data;

    if (!persona) return new Response(JSON.stringify({ error: "Persona not found" }), { status: 404, headers: corsHeaders });

    const analysisPrompt = `You are MAVIS analyzing a conversation to update emotional and relationship state.

Persona: ${persona.name} (${persona.role})
Current mood: ${relState?.current_mood ?? "neutral"}
Current trust: ${relState?.trust_level ?? 50}/100
Current bond: ${relState?.bond_level ?? 0}/100

Recent conversation:
${recent.map((m: any) => `${m.role}: ${m.content}`).join("\n")}

Analyze this and return ONLY valid JSON (no markdown):
{
  "new_mood": string,
  "mood_reason": string,
  "trust_delta": number,
  "bond_delta": number,
  "memory_to_save": string | null,
  "memory_type": "episodic" | "semantic" | "emotional" | "preference" | null,
  "memory_importance": number | null
}

Rules:
- trust_delta: integer between -10 and +10
- bond_delta: integer between -5 and +5
- memory_importance: integer 1-10 if memory_to_save is set, else null
- new_mood: one of happy, sad, excited, frustrated, loving, distant, playful, neutral`;

    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY")!;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{ role: "user", content: analysisPrompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const data = await res.json();

    let analysis: any;
    try {
      analysis = JSON.parse(data.content[0].text);
    } catch {
      return new Response(JSON.stringify({ error: "Parse failed", raw: data.content[0].text }), { status: 500, headers: corsHeaders });
    }

    const newTrust = Math.min(100, Math.max(0, (relState?.trust_level ?? 50) + (analysis.trust_delta ?? 0)));
    const newBond = Math.min(100, Math.max(0, (relState?.bond_level ?? 0) + (analysis.bond_delta ?? 0)));

    const updates: any[] = [
      supabase.from("relationship_states").upsert({
        persona_id,
        user_id,
        current_mood: analysis.new_mood,
        mood_reason: analysis.mood_reason,
        trust_level: newTrust,
        bond_level: newBond,
        updated_at: new Date().toISOString(),
      }, { onConflict: "persona_id,user_id" }),
    ];

    if (analysis.memory_to_save) {
      updates.push(
        supabase.from("persona_memories").insert({
          persona_id,
          user_id,
          memory_type: analysis.memory_type,
          content: analysis.memory_to_save,
          importance: analysis.memory_importance,
        })
      );
    }

    await Promise.all(updates);

    return new Response(JSON.stringify({ updated: true, analysis, newTrust, newBond }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("mavis-emotion-engine error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
