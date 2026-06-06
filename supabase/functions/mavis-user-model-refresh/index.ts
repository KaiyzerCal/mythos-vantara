// mavis-user-model-refresh
// Synthesizes a behavioral model (USER.md pattern) from recent chat history,
// tacit memory, and goal data. Runs daily at 3am UTC via pg_cron.
// The synthesized model is injected into every mavis-chat turn as <memory-context>.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYNTHESIS_PROMPT = `You are analyzing the behavioral patterns of an operator named Calvin (or Caliyah) to build a precise behavioral model. This model will be injected into every future conversation to give MAVIS persistent understanding of who she's talking to.

Analyze the provided data and synthesize a behavioral model. Be specific, not generic. Base every statement on evidence in the data.

Respond with ONLY a valid JSON object matching this schema:
{
  "personality_summary": "2-3 sentence behavioral synthesis. Specific traits observed in this person's patterns, not platitudes.",
  "communication_style": {
    "tone": "e.g. direct, analytical, competitive, warm",
    "pace": "e.g. fast, methodical, burst-focused",
    "formality": "casual|mixed|formal",
    "verbosity": "terse|balanced|detailed",
    "preferred_format": "e.g. bullet points, narrative, tables"
  },
  "decision_patterns": {
    "risk_tolerance": "low|medium|high|variable",
    "analysis_depth": "quick|thorough|exhaustive",
    "decision_speed": "fast|deliberate|slow"
  },
  "core_values": ["value1", "value2", "value3"],
  "primary_goals": ["goal1 (specific)", "goal2 (specific)"],
  "working_style": {
    "peak_hours": "e.g. late night, early morning, variable",
    "focus_blocks": "e.g. long deep work sessions",
    "energy_patterns": "e.g. high intensity with recovery cycles"
  },
  "triggers": {
    "energizers": ["what drives them"],
    "drains": ["what depletes them"],
    "warnings": ["patterns that suggest struggle or misalignment"]
  },
  "raw_synthesis": "A 3-5 paragraph free-form behavioral analysis that MAVIS can reference for nuanced context."
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey   = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_AI_API_KEY") ?? "";
  const claudeKey   = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const openaiKey   = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";

  const sb = createClient(supabaseUrl, serviceKey);

  let targetUserId: string | null = null;
  let isCronRun = false;

  try {
    const body = await req.json().catch(() => ({}));
    isCronRun = body.trigger === "cron";

    if (body.user_id) {
      targetUserId = body.user_id;
    }
  } catch { /* no body */ }

  // On cron runs, refresh all users; on direct calls, refresh a specific user
  const usersToRefresh: string[] = [];

  if (targetUserId) {
    usersToRefresh.push(targetUserId);
  } else if (isCronRun) {
    // Get all users with recent activity (interacted with MAVIS in last 7 days)
    const { data: activeUsers } = await sb
      .from("mavis_memory")
      .select("user_id")
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(50);
    const uniqueIds = [...new Set((activeUsers ?? []).map((r: any) => r.user_id as string))];
    usersToRefresh.push(...uniqueIds);
  } else {
    // Auth-based single user call
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const userSb = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userSb.auth.getUser();
      if (user) usersToRefresh.push(user.id);
    }
  }

  if (usersToRefresh.length === 0) {
    return new Response(JSON.stringify({ refreshed: 0, message: "No users to refresh" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let refreshed = 0;
  const errors: string[] = [];

  for (const uid of usersToRefresh) {
    try {
      // Gather data for synthesis (parallel queries)
      const [recentMemoryRes, tacitRes, goalsRes, questsRes, journalRes, bondRes] = await Promise.all([
        sb.from("mavis_memory")
          .select("role, content, timestamp")
          .eq("user_id", uid)
          .order("timestamp", { ascending: false })
          .limit(40),
        sb.from("mavis_tacit")
          .select("category, key, value")
          .eq("user_id", uid)
          .order("confidence", { ascending: false })
          .limit(40),
        sb.from("mavis_goals")
          .select("objective, status, context")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10),
        sb.from("quests")
          .select("title, type, status, xp_reward")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(15),
        sb.from("journal_entries")
          .select("title, content, category, mood, importance")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10),
        sb.from("mavis_bond")
          .select("interaction_count, bond_level, trust_level")
          .eq("user_id", uid)
          .maybeSingle(),
      ]);

      const memory    = (recentMemoryRes.data ?? []) as any[];
      const tacit     = (tacitRes.data ?? []) as any[];
      const goals     = (goalsRes.data ?? []) as any[];
      const quests    = (questsRes.data ?? []) as any[];
      const journal   = (journalRes.data ?? []) as any[];
      const bond      = bondRes.data as any;

      if (memory.length < 5 && tacit.length < 3) {
        // Not enough data to synthesize meaningfully — skip
        continue;
      }

      // Build synthesis input
      const memoryLines = memory
        .slice(0, 20)
        .map((m: any) => `[${m.role}]: ${String(m.content ?? "").slice(0, 300)}`)
        .join("\n");

      const tacitLines = tacit
        .map((t: any) => `[${t.category}] ${t.key}: ${t.value}`)
        .join("\n");

      const goalsLines = goals
        .map((g: any) => `• ${g.objective} (${g.status})`)
        .join("\n");

      const questLines = quests
        .filter((q: any) => q.status !== "failed")
        .slice(0, 8)
        .map((q: any) => `• ${q.title} [${q.type}/${q.status}] +${q.xp_reward}XP`)
        .join("\n");

      const journalLines = journal
        .slice(0, 5)
        .map((j: any) => `• [${j.category}/${j.mood ?? "?"}/${j.importance}] ${j.title}: ${String(j.content ?? "").slice(0, 150)}`)
        .join("\n");

      const interactionCount = bond?.interaction_count ?? 0;
      const bondLevel = bond?.bond_level ?? 0;

      const synthesisInput = `
INTERACTION STATS: ${interactionCount} total exchanges, bond level ${bondLevel}/100

RECENT CONVERSATION EXCERPTS (last 20 exchanges):
${memoryLines || "None yet"}

TACIT KNOWLEDGE (learned preferences and rules):
${tacitLines || "None yet"}

ACTIVE GOALS:
${goalsLines || "None"}

QUEST HISTORY (recent):
${questLines || "None"}

JOURNAL THEMES (recent):
${journalLines || "None"}
`.trim();

      // Synthesize via AI cascade
      let raw = "";

      if (geminiKey) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYNTHESIS_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: synthesisInput }] }],
              generationConfig: { maxOutputTokens: 1000, temperature: 0.3 },
            }),
          });
          if (r.ok) {
            const d = await r.json();
            raw = d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          }
        } catch { /* try next */ }
      }

      if (!raw && claudeKey) {
        try {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": claudeKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 1000,
              system: SYNTHESIS_PROMPT,
              messages: [{ role: "user", content: synthesisInput }],
            }),
          });
          if (r.ok) { const d = await r.json(); raw = d.content?.[0]?.text ?? ""; }
        } catch { /* try next */ }
      }

      if (!raw && openaiKey) {
        try {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "system", content: SYNTHESIS_PROMPT }, { role: "user", content: synthesisInput }],
              max_tokens: 1000,
              temperature: 0.3,
            }),
          });
          if (r.ok) { const d = await r.json(); raw = d.choices?.[0]?.message?.content ?? ""; }
        } catch { /* give up */ }
      }

      if (!raw) continue;

      // Parse JSON from AI response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      let model: any;
      try {
        model = JSON.parse(jsonMatch[0]);
      } catch { continue; }

      // Get current version for increment
      const { data: existing } = await sb
        .from("mavis_user_model")
        .select("synthesis_version, session_count")
        .eq("user_id", uid)
        .maybeSingle();

      const currentVersion = (existing as any)?.synthesis_version ?? 0;

      await sb.from("mavis_user_model").upsert({
        user_id:              uid,
        personality_summary:  String(model.personality_summary ?? "").slice(0, 1000),
        communication_style:  model.communication_style ?? {},
        decision_patterns:    model.decision_patterns ?? {},
        core_values:          Array.isArray(model.core_values) ? model.core_values.slice(0, 10) : [],
        primary_goals:        Array.isArray(model.primary_goals) ? model.primary_goals.slice(0, 5) : [],
        working_style:        model.working_style ?? {},
        triggers:             model.triggers ?? {},
        raw_synthesis:        String(model.raw_synthesis ?? "").slice(0, 3000),
        last_synthesized_at:  new Date().toISOString(),
        synthesis_version:    currentVersion + 1,
        session_count:        interactionCount,
        confidence_score:     Math.min(1.0, 0.1 + (interactionCount / 200)),
        updated_at:           new Date().toISOString(),
      }, { onConflict: "user_id" });

      refreshed++;
    } catch (e) {
      errors.push(`${uid}: ${(e as Error).message}`);
    }
  }

  return new Response(JSON.stringify({ refreshed, errors: errors.slice(0, 5) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
