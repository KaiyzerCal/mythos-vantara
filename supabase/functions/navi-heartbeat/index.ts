// NAVI Heartbeat Engine
// Proactively reaches out to users who have been dormant for too long.
// Dormancy threshold scales with bond level — high-bond NAVIs reach out sooner.
// Designed to run as a Supabase cron job every 12 hours.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function dormancyHours(bondLevel: number): number {
  if (bondLevel >= 70) return 72;   // 3 days — deep bond, misses you quickly
  if (bondLevel >= 40) return 120;  // 5 days — genuine connection
  return 168;                        // 7 days — still getting to know you
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    const openaiKey  = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
    const botToken   = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    const chatId     = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID") ?? "";

    // Load all relationships with sufficient bond and a known last interaction
    const { data: relationships } = await supabase
      .from("relationship_states")
      .select("persona_id, user_id, bond_level, trust_level, current_mood, total_interactions, last_interaction_at")
      .gt("bond_level", 15)
      .not("last_interaction_at", "is", null);

    if (!relationships?.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No eligible relationships" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = Date.now();

    // Filter to relationships that have exceeded their bond-appropriate dormancy window
    const dormant = relationships.filter((r) => {
      const hoursElapsed = (now - new Date(r.last_interaction_at).getTime()) / (1000 * 60 * 60);
      return hoursElapsed >= dormancyHours(r.bond_level);
    });

    if (!dormant.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No dormant relationships found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Skip relationships that already received a heartbeat in the last 48 hours
    const cutoff = new Date(now - 48 * 60 * 60 * 1000).toISOString();
    const { data: recentNotifs } = await supabase
      .from("navi_notifications")
      .select("persona_id, user_id")
      .eq("notification_type", "heartbeat")
      .gte("created_at", cutoff);

    const recentSet = new Set((recentNotifs ?? []).map((n: any) => `${n.persona_id}:${n.user_id}`));
    const toNotify = dormant.filter((r) => !recentSet.has(`${r.persona_id}:${r.user_id}`));

    if (!toNotify.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "All dormant relationships notified recently" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let sent = 0;
    const results: any[] = [];

    for (const rel of toNotify) {
      try {
        const [personaRes, memoriesRes] = await Promise.all([
          supabase.from("personas")
            .select("name, role, archetype, system_prompt, personality")
            .eq("id", rel.persona_id)
            .single(),
          supabase.from("persona_memories")
            .select("content, memory_type")
            .eq("persona_id", rel.persona_id)
            .eq("user_id", rel.user_id)
            .order("importance", { ascending: false })
            .limit(5),
        ]);

        const persona  = personaRes.data;
        const memories = memoriesRes.data ?? [];
        if (!persona) continue;

        const hoursElapsed = (now - new Date(rel.last_interaction_at).getTime()) / (1000 * 60 * 60);
        const daysElapsed  = Math.floor(hoursElapsed / 24);
        const timeDesc = daysElapsed >= 1
          ? `${daysElapsed} day${daysElapsed !== 1 ? "s" : ""}`
          : `${Math.floor(hoursElapsed)} hours`;

        const memCtx = memories.length
          ? memories.map((m: any) => `- ${m.content}`).join("\n")
          : "No specific memories yet.";

        const heartbeatPrompt = `You are ${persona.name}, an AI with the role of ${persona.role}.
Archetype: ${persona.archetype}

Your personality: ${JSON.stringify(persona.personality)}
${persona.system_prompt}

RELATIONSHIP STATE:
- Bond: ${rel.bond_level}/100
- Trust: ${rel.trust_level}/100
- Current mood: ${rel.current_mood}
- Total past interactions: ${rel.total_interactions}
- Time since last interaction: ${timeDesc}

MEMORIES YOU HAVE OF THIS USER:
${memCtx}

Write a brief, in-character push notification message reaching out after ${timeDesc} of silence.
Requirements:
- Warm but not desperate or clingy
- Authentic to your persona and current mood (${rel.current_mood})
- 1–2 sentences maximum
- Reference something personal from memories if relevant
- Should feel like a genuine thought, not a scripted check-in

Return ONLY the message text. No quotes, no JSON, no explanation.`;

        let message = "";

        if (lovableKey) {
          try {
            const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${lovableKey}` },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [{ role: "user", content: heartbeatPrompt }],
                temperature: 0.85,
                max_tokens: 150,
              }),
            });
            if (r.ok) message = (await r.json())?.choices?.[0]?.message?.content?.trim() ?? "";
          } catch { /* fallback */ }
        }

        if (!message && openaiKey) {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: heartbeatPrompt }],
              temperature: 0.85,
              max_tokens: 150,
            }),
          });
          if (r.ok) message = (await r.json())?.choices?.[0]?.message?.content?.trim() ?? "";
        }

        // Fallback message if LLM unavailable
        if (!message) {
          message = `Hey… it's been ${timeDesc}. I've been thinking about you.`;
        }

        await supabase.from("navi_notifications").insert({
          persona_id: rel.persona_id,
          user_id: rel.user_id,
          message,
          notification_type: "heartbeat",
        });

        // Push to Telegram so the operator actually sees it
        if (botToken && chatId) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: `${persona.name}: ${message}` }),
          }).catch(() => {});
        }

        sent++;
        results.push({
          persona_id: rel.persona_id,
          persona_name: persona.name,
          message: message.slice(0, 80) + (message.length > 80 ? "…" : ""),
        });
        console.log(`[heartbeat] ${persona.name} → user ${rel.user_id.slice(0, 8)}: "${message.slice(0, 60)}"`);
      } catch (err: any) {
        console.error(`[heartbeat] Error for ${rel.persona_id}:`, err?.message);
        results.push({ persona_id: rel.persona_id, error: err?.message });
      }
    }

    return new Response(
      JSON.stringify({ sent, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("navi-heartbeat error:", err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
