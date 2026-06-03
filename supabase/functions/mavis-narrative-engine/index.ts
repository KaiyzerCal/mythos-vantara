// mavis-narrative-engine
// Writes a living narrative about the operator — who they are, what they're building,
// recurring themes, and their current life arc. Updated weekly.
// The identity_summary gets injected into every MAVIS chat response.
// verify_jwt = false (cron + service-role triggers)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const sb = () => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function buildNarrative(userId: string): Promise<{
  narrative: string; identity_summary: string; themes: string[]; arc: string;
}> {
  const [profileRes, questsRes, memoriesRes, journalRes, tacitRes, entitiesRes, prevNarrativeRes] = await Promise.all([
    sb().from("profiles").select("display_name,rank,level,bio").eq("id", userId).maybeSingle(),
    sb().from("quests").select("title,description,status,type").eq("user_id", userId).order("created_at", { ascending: false }).limit(15),
    sb().from("mavis_memory").select("content,importance_score").eq("user_id", userId).order("importance_score", { ascending: false }).limit(20),
    sb().from("journal_entries").select("content,mood,tags").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    sb().from("mavis_tacit").select("category,value").eq("user_id", userId).in("category", ["hard_rule","preference","lesson_learned"]).limit(20),
    sb().from("mavis_entities").select("name,entity_type,description").eq("user_id", userId).order("mention_count", { ascending: false }).limit(15),
    sb().from("mavis_narrative").select("narrative,themes").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const profile = profileRes.data;
  const quests = questsRes.data ?? [];
  const memories = memoriesRes.data ?? [];
  const journals = journalRes.data ?? [];
  const tacit = tacitRes.data ?? [];
  const entities = entitiesRes.data ?? [];
  const prevNarrative = prevNarrativeRes.data;

  const name = profile?.display_name ?? "the operator";
  const rank = profile?.rank ?? "Initiate";
  const level = profile?.level ?? 1;

  if (!ANTHROPIC_KEY) {
    return {
      narrative: `${name} is a ${rank} (Level ${level}) building their path through ${quests.filter((q: any) => q.status === "active").length} active quests.`,
      identity_summary: `${name} — ${rank} L${level}, focused on building and growth.`,
      themes: [],
      arc: "",
    };
  }

  const context = [
    `OPERATOR: ${name} (${rank}, Level ${level})`,
    `ACTIVE QUESTS: ${quests.filter((q: any) => q.status === "active").map((q: any) => q.title).join(", ")}`,
    `COMPLETED QUESTS: ${quests.filter((q: any) => q.status === "completed").map((q: any) => q.title).join(", ")}`,
    `TOP MEMORIES: ${memories.slice(0, 8).map((m: any) => m.content.slice(0, 100)).join(" | ")}`,
    `JOURNAL THEMES: ${journals.slice(0, 5).map((j: any) => j.content.slice(0, 80)).join(" | ")}`,
    `KEY PRINCIPLES: ${tacit.filter((t: any) => t.category === "hard_rule").map((t: any) => t.value.slice(0, 80)).join(" | ")}`,
    `KEY PEOPLE/PROJECTS: ${entities.filter((e: any) => ["person","project","company"].includes(e.entity_type)).slice(0, 8).map((e: any) => `${e.name}(${e.entity_type})`).join(", ")}`,
    prevNarrative ? `PREVIOUS NARRATIVE THEMES: ${(prevNarrative.themes ?? []).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `You are MAVIS writing a living narrative about your operator. This becomes part of your identity context for every conversation.

DATA:
${context}

Generate a narrative that captures who this person truly is — not generic, but specific to what the data reveals.

Return JSON:
{
  "narrative": "3-4 paragraph narrative in third person about who they are, what they're building, and what drives them",
  "identity_summary": "2 sentences in present tense capturing the essence of who they are and what they're about right now (this is injected into every conversation)",
  "themes": ["theme1", "theme2", "theme3", "theme4"],
  "arc": "1 sentence describing the current life arc or chapter they're in"
}

Be specific, insightful, and authentic. Return ONLY valid JSON.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Claude error: ${res.status}`);
    const d = await res.json();
    const text = d.content?.find((b: any) => b.type === "text")?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      narrative: String(parsed.narrative ?? ""),
      identity_summary: String(parsed.identity_summary ?? ""),
      themes: Array.isArray(parsed.themes) ? parsed.themes.map(String) : [],
      arc: String(parsed.arc ?? ""),
    };
  } catch {
    return {
      narrative: `${name} is on a path of growth and building.`,
      identity_summary: `${name} — ${rank} Level ${level}, actively building and pursuing their mission.`,
      themes: [],
      arc: "",
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any = {};
  try { if (req.method === "POST") body = await req.json().catch(() => ({})); } catch { /**/ }

  const isCron = Boolean(body?.cron);

  let targetUserId: string | null = null;
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  if (isCron || token === SB_KEY) {
    targetUserId = body.user_id ?? null;
  } else {
    const { data: { user } } = await createClient(SB_URL, SB_KEY).auth.getUser(token);
    targetUserId = user?.id ?? null;
  }

  try {
    if (isCron) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: activeUsers } = await sb().from("mavis_memory").select("user_id").gte("created_at", cutoff).limit(100);
      const uniqueUsers = [...new Set((activeUsers ?? []).map((r: any) => r.user_id as string))];
      let processed = 0;
      for (const uid of uniqueUsers) {
        try {
          const narrative = await buildNarrative(uid);
          await sb().from("mavis_narrative").insert({ user_id: uid, ...narrative });
          processed++;
        } catch (err: any) { console.error(`[narrative-engine] ${uid}:`, err.message); }
      }
      return json({ users_processed: processed });
    }

    if (!targetUserId) return json({ error: "Unauthorized" }, 401);
    const narrative = await buildNarrative(targetUserId);
    await sb().from("mavis_narrative").insert({ user_id: targetUserId, ...narrative });
    return json({ success: true, narrative });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[narrative-engine]", msg);
    return json({ error: msg }, 500);
  }
});
