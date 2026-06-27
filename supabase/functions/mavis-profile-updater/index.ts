// mavis-profile-updater — Hermes-style user profile synthesis
// Called after meaningful conversations (or on demand) to update the persistent
// mavis_user_profile record. Reads recent chat messages + auto-memories and
// synthesizes: who the user is, their communication style, standing key context,
// preferences, and topics of interest. Profile is then injected into MAVIS at
// every thread start via mavis-context-scout.

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const supabase  = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { user_id } = await req.json() as { user_id: string };
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: CORS });
    }

    // Collect raw material for synthesis
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const [existingRes, recentMsgsRes, memoriesRes, questsRes, goalsRes, profileRes] = await Promise.all([
      // Current profile (if any)
      supabase.from("mavis_user_profile")
        .select("profile_md, communication_style, key_context, preferences, topics_of_interest")
        .eq("user_id", user_id)
        .maybeSingle(),

      // Recent user messages from MAVIS chat (sample of last 60)
      supabase.from("chat_messages")
        .select("content, created_at")
        .eq("user_id", user_id)
        .eq("role", "user")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(60),

      // Auto-memories from events (quest completions, journal, goals)
      supabase.from("memories")
        .select("title, content, memory_type, tags")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(20),

      // Completed quests (who this person is / what they pursue)
      supabase.from("quests")
        .select("title, type")
        .eq("user_id", user_id)
        .eq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(10),

      // Active goals (what they care about right now)
      supabase.from("mavis_goals")
        .select("objective, context")
        .eq("user_id", user_id)
        .eq("status", "active")
        .limit(5),

      // Auth profile (name, etc.)
      supabase.from("profiles")
        .select("display_name, title, location")
        .eq("id", user_id)
        .maybeSingle(),
    ]);

    const existing  = existingRes.data;
    const msgs      = (recentMsgsRes.data  ?? []).map((m: any) => m.content?.slice(0, 200)).filter(Boolean);
    const memories  = memoriesRes.data  ?? [];
    const quests    = questsRes.data    ?? [];
    const goals     = goalsRes.data     ?? [];
    const profile   = profileRes.data;

    // Build synthesis context
    const context = [
      profile?.display_name ? `User name: ${profile.display_name}` : "",
      profile?.title        ? `Title/role: ${profile.title}` : "",
      goals.length > 0 ? `Active goals:\n${goals.map((g: any) => `- ${g.objective}: ${g.context?.slice(0, 100) ?? ""}`).join("\n")}` : "",
      quests.length > 0 ? `Completed quests (what they pursue): ${quests.map((q: any) => q.title).join(", ")}` : "",
      memories.length > 0 ? `MAVIS auto-memories:\n${memories.map((m: any) => `- [${m.memory_type}] ${m.title}: ${m.content?.slice(0, 100) ?? ""}`).join("\n")}` : "",
      msgs.length > 0 ? `Sample of their recent messages to MAVIS:\n${msgs.slice(0, 20).map((m, i) => `${i + 1}. "${m}"`).join("\n")}` : "",
      existing?.profile_md ? `\nEXISTING PROFILE (update, don't discard):\n${existing.profile_md}` : "",
    ].filter(Boolean).join("\n\n");

    if (!context.trim()) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "Not enough data yet" }), { headers: CORS });
    }

    // Synthesize with Claude
    const res = await anthropic.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 1200,
      system: `You are a behavioral analyst building a persistent user profile for an AI assistant.
Analyze the provided context and produce a structured JSON profile that MAVIS can use to personalize responses.

Output ONLY valid JSON — no markdown, no explanation. Schema:
{
  "profile_md": "2-4 paragraph Markdown overview: who this person is, what drives them, their life situation, recurring themes",
  "communication_style": "1-2 sentences: how they communicate (terse/verbose, casual/formal, direct/exploratory, etc.)",
  "key_context": "Bullet list of 3-6 standing facts MAVIS should always know (e.g. 'Building a SaaS product', 'Early riser, most productive 5-10am')",
  "preferences": {"key": "value"},
  "topics_of_interest": ["array", "of", "topics"]
}`,
      messages: [{ role: "user", content: `Synthesize this context into a user profile:\n\n${context}` }],
    });

    let synthesized: Record<string, unknown>;
    try {
      const raw = ((res.content[0] as { text: string }).text ?? "").trim();
      synthesized = JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```\s*$/, ""));
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse LLM output as JSON" }), { status: 500, headers: CORS });
    }

    // Upsert profile
    const { error: upsertErr } = await supabase
      .from("mavis_user_profile")
      .upsert({
        user_id,
        profile_md:          String(synthesized.profile_md ?? ""),
        communication_style: String(synthesized.communication_style ?? ""),
        key_context:         String(synthesized.key_context ?? ""),
        preferences:         (synthesized.preferences as Record<string, unknown>) ?? {},
        topics_of_interest:  Array.isArray(synthesized.topics_of_interest) ? synthesized.topics_of_interest : [],
        updated_at:          new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (upsertErr) throw new Error(upsertErr.message);

    return new Response(
      JSON.stringify({ ok: true, profile_md_length: String(synthesized.profile_md ?? "").length }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  } catch (err) {
    console.error("[mavis-profile-updater]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
