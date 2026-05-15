// NAVI Memory Consolidator
// Distills accumulated episodic memories into compact semantic summaries —
// analogous to human sleep consolidation. Designed to run as a Supabase cron
// job (e.g., every 6 hours) but also invokable manually.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_EPISODIC = 10;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const openaiKey  = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
    const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";

    // Find all (persona_id, user_id) combos with unconsolidated episodic memories.
    const { data: candidates } = await supabase
      .from("persona_memories")
      .select("persona_id, user_id")
      .eq("memory_type", "episodic")
      .is("consolidated_at", null)
      .order("created_at", { ascending: true });

    if (!candidates?.length) {
      return new Response(
        JSON.stringify({ consolidated: 0, message: "No unconsolidated episodic memories" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Group by persona_id + user_id and count
    const groups = new Map<string, { persona_id: string; user_id: string; count: number }>();
    for (const c of candidates) {
      const key = `${c.persona_id}:${c.user_id}`;
      if (!groups.has(key)) groups.set(key, { persona_id: c.persona_id, user_id: c.user_id, count: 0 });
      groups.get(key)!.count++;
    }

    const toProcess = Array.from(groups.values()).filter((g) => g.count >= MIN_EPISODIC);

    if (!toProcess.length) {
      return new Response(
        JSON.stringify({ consolidated: 0, message: `${groups.size} group(s) found, none reached ${MIN_EPISODIC} memories` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let totalConsolidated = 0;
    const results: any[] = [];

    for (const group of toProcess) {
      try {
        const [personaRes, episodicsRes] = await Promise.all([
          supabase.from("personas").select("name, role, archetype").eq("id", group.persona_id).single(),
          supabase.from("persona_memories")
            .select("id, content, importance")
            .eq("persona_id", group.persona_id)
            .eq("user_id", group.user_id)
            .eq("memory_type", "episodic")
            .is("consolidated_at", null)
            .order("created_at", { ascending: true })
            .limit(50),
        ]);

        const persona  = personaRes.data;
        const episodics = episodicsRes.data ?? [];
        if (!episodics.length) continue;

        const episodicText = episodics
          .map((m, i) => `${i + 1}. [importance:${m.importance}] ${m.content}`)
          .join("\n");

        const consolidationPrompt = `You are distilling episodic memories for ${persona?.name ?? "an AI persona"} (${persona?.role ?? "companion"}).

Below are ${episodics.length} raw episodic memory fragments collected about a user.
Synthesize them into 2–3 compact semantic summaries capturing the most important patterns, preferences, and facts.

EPISODIC MEMORIES:
${episodicText}

Return ONLY valid minified JSON:
{"summaries":[{"content":"<one concise sentence>","importance":<7-9>},...]}

Rules:
- Maximum 3 summaries
- Each is a standalone fact or pattern about the user
- importance 9=defining; 8=significant pattern; 7=useful preference
- Never include trivial details`;

        let summaries: { content: string; importance: number }[] = [];

        // Prefer Lovable AI Gateway (free), fall back to OpenAI
        if (lovableKey) {
          try {
            const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${lovableKey}` },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "system", content: "Output only minified JSON matching the requested schema." },
                  { role: "user", content: consolidationPrompt },
                ],
                temperature: 0.3,
              }),
            });
            if (r.ok) {
              const d = await r.json();
              const raw = (d?.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
              summaries = JSON.parse(raw).summaries ?? [];
            }
          } catch (e) {
            console.warn(`[consolidator] Lovable failed for ${group.persona_id}:`, e);
          }
        }

        if (!summaries.length && openaiKey) {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: "Output only minified JSON matching the requested schema." },
                { role: "user", content: consolidationPrompt },
              ],
              temperature: 0.3,
              max_tokens: 512,
            }),
          });
          if (r.ok) {
            const d = await r.json();
            const raw = (d?.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
            summaries = JSON.parse(raw).summaries ?? [];
          }
        }

        if (!summaries.length) {
          console.warn(`[consolidator] No summaries for ${group.persona_id}`);
          continue;
        }

        // Embed and insert each semantic summary
        const insertedIds: string[] = [];
        for (const summary of summaries.slice(0, 3)) {
          let embedding: number[] | null = null;
          if (openaiKey) {
            try {
              const er = await fetch("https://api.openai.com/v1/embeddings", {
                method: "POST",
                headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: "text-embedding-3-small", input: summary.content }),
              });
              if (er.ok) embedding = (await er.json())?.data?.[0]?.embedding ?? null;
            } catch { /* store without vector */ }
          }

          const { data: ins } = await supabase
            .from("persona_memories")
            .insert({
              persona_id: group.persona_id,
              user_id: group.user_id,
              memory_type: "semantic",
              content: summary.content,
              importance: Math.min(9, Math.max(7, Math.round(summary.importance ?? 8))),
              consolidated_at: new Date().toISOString(),
              ...(embedding ? { embedding } : {}),
            })
            .select("id")
            .single();

          if (ins?.id) insertedIds.push(ins.id);
        }

        // Mark all source episodics as consolidated
        await supabase
          .from("persona_memories")
          .update({ consolidated_at: new Date().toISOString() })
          .in("id", episodics.map((m) => m.id));

        totalConsolidated++;
        results.push({
          persona_id: group.persona_id,
          episodics_processed: episodics.length,
          summaries_created: insertedIds.length,
        });
        console.log(`[consolidator] ${persona?.name ?? group.persona_id}: ${episodics.length} episodics → ${insertedIds.length} semantic summaries`);
      } catch (err: any) {
        console.error(`[consolidator] Error for ${group.persona_id}:`, err?.message);
        results.push({ persona_id: group.persona_id, error: err?.message });
      }
    }

    return new Response(
      JSON.stringify({ consolidated: totalConsolidated, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("navi-memory-consolidator error:", err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
