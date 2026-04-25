import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── LLM adapter — Lovable AI Gateway (free, no per-provider keys) ────────────

function mapToGatewayModel(model: string): string {
  // Map any persona-configured model to a supported Lovable AI Gateway model.
  if (!model) return "google/gemini-2.5-flash";
  const m = model.toLowerCase();
  if (m.startsWith("google/")) return model;
  if (m.startsWith("openai/")) return model;
  if (m.includes("gpt-5")) return "openai/gpt-5";
  if (m.includes("gpt-4") || m.includes("gpt-4o")) return "openai/gpt-5-mini";
  if (m.includes("claude")) return "google/gemini-2.5-pro";
  if (m.includes("grok")) return "google/gemini-2.5-flash";
  if (m.includes("gemini-2.5-pro")) return "google/gemini-2.5-pro";
  if (m.includes("gemini")) return "google/gemini-2.5-flash";
  return "google/gemini-2.5-flash";
}

async function callLLM(model: string, system: string, messages: any[]): Promise<string> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  const gatewayModel = mapToGatewayModel(model);

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: gatewayModel,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) throw new Error("Rate limit reached. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
    throw new Error(`AI Gateway ${res.status}: ${errText}`);
  }

  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
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

    const { persona_id, user_id, message, attachment_ids } = await req.json();
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

    // Load relationship state, conversation history, top memories, attachments, AND full app context in parallel
    const [relRes, histRes, memRes, attRes, profileRes, questsRes, skillsRes, journalRes, vaultRes, inventoryRes, energyRes, transformationsRes, rankingsRes, councilsRes, alliesRes, ritualsRes] = await Promise.all([
      supabase.from("relationship_states").select("*").eq("persona_id", persona_id).eq("user_id", user_id).single(),
      supabase.from("persona_conversations").select("role, content").eq("persona_id", persona_id).eq("user_id", user_id).order("created_at", { ascending: false }).limit(20),
      supabase.from("persona_memories").select("content, memory_type, importance").eq("persona_id", persona_id).eq("user_id", user_id).order("importance", { ascending: false }).limit(10),
      (Array.isArray(attachment_ids) && attachment_ids.length > 0
        ? supabase.from("chat_attachments").select("id,file_name,mime_type,extracted_text,processing_status").eq("user_id", user_id).in("id", attachment_ids)
        : supabase.from("chat_attachments").select("id,file_name,mime_type,extracted_text,processing_status").eq("user_id", user_id).eq("chat_kind", "persona").eq("thread_ref", persona_id).order("created_at", { ascending: false }).limit(10)),
      supabase.from("profiles").select("*").eq("id", user_id).single(),
      supabase.from("quests").select("id,title,status,type,difficulty,progress_current,progress_target,description").eq("user_id", user_id).order("created_at", { ascending: false }).limit(15),
      supabase.from("skills").select("id,name,category,tier,proficiency,energy_type,unlocked").eq("user_id", user_id).limit(20),
      supabase.from("journal_entries").select("id,title,category,importance,mood,content").eq("user_id", user_id).order("created_at", { ascending: false }).limit(8),
      supabase.from("vault_entries").select("id,title,category,importance,content").eq("user_id", user_id).order("created_at", { ascending: false }).limit(8),
      supabase.from("inventory").select("id,name,type,rarity,quantity,is_equipped,slot,effect").eq("user_id", user_id).limit(25),
      supabase.from("energy_systems").select("id,type,current_value,max_value,status,description").eq("user_id", user_id),
      supabase.from("transformations").select("id,name,tier,form_order,energy,unlocked,description").eq("user_id", user_id).order("form_order", { ascending: true }),
      supabase.from("rankings_profiles").select("id,display_name,rank,level,gpr,pvp,influence,is_self").eq("user_id", user_id).limit(20),
      supabase.from("councils").select("id,name,role,class,specialty").eq("user_id", user_id),
      supabase.from("allies").select("id,name,relationship,level,specialty,affinity").eq("user_id", user_id).limit(15),
      supabase.from("rituals").select("id,name,type,streak,completed").eq("user_id", user_id),
    ]);

    const relState = relRes.data;
    const history = (histRes.data ?? []).reverse();
    const memories = memRes.data ?? [];
    const attachments = attRes.data ?? [];
    const profile = profileRes.data;

    const memoryContext = memories.map((m: any) => `[${m.memory_type}] ${m.content}`).join("\n");

    // App-context block — gives the persona awareness of the user's full state
    const appCtx = profile ? `

═══ APP CONTEXT (everything you know about ${profile.inscribed_name || "this user"}) ═══
PROFILE: ${profile.inscribed_name} — Lv${profile.level} [${profile.rank}] — Form: ${profile.current_form}
Stats: STR:${profile.stat_str} AGI:${profile.stat_agi} INT:${profile.stat_int} VIT:${profile.stat_vit} WIS:${profile.stat_wis} CHA:${profile.stat_cha} LCK:${profile.stat_lck}
Arc: ${profile.arc_story} | XP: ${profile.xp}/${profile.xp_to_next_level} | GPR: ${profile.gpr} | Fatigue: ${profile.fatigue}

QUESTS (${(questsRes.data || []).length}):
${(questsRes.data || []).map((q: any) => `  • [${q.id}] "${q.title}" [${q.status}/${q.type}] ${q.progress_current}/${q.progress_target}${q.description ? ` — ${q.description.slice(0, 120)}` : ""}`).join("\n") || "  None"}

SKILLS (${(skillsRes.data || []).length}):
${(skillsRes.data || []).map((s: any) => `  • ${s.name} (${s.category}, T${s.tier}, ${s.proficiency}%, ${s.energy_type})`).join("\n") || "  None"}

JOURNAL ENTRIES:
${(journalRes.data || []).map((j: any) => `  • [${j.id}] "${j.title}" [${j.category}/${j.importance}${j.mood ? `/${j.mood}` : ""}] — ${(j.content || "").slice(0, 250)}`).join("\n") || "  None"}

VAULT ENTRIES:
${(vaultRes.data || []).map((v: any) => `  • [${v.id}] "${v.title}" [${v.category}/${v.importance}] — ${(v.content || "").slice(0, 200)}`).join("\n") || "  None"}

INVENTORY:
${(inventoryRes.data || []).map((i: any) => `  • ${i.name} [${i.rarity}/${i.type}] x${i.quantity}${i.is_equipped ? " (equipped)" : ""}${i.effect ? ` — ${i.effect}` : ""}`).join("\n") || "  None"}

ENERGY SYSTEMS:
${(energyRes.data || []).map((e: any) => `  • ${e.type}: ${e.current_value}/${e.max_value} [${e.status}]${e.description ? ` — ${e.description.slice(0, 120)}` : ""}`).join("\n") || "  None"}

TRANSFORMATIONS / FORMS:
${(transformationsRes.data || []).map((t: any) => `  • ${t.name} (T${t.form_order}, ${t.tier}, ${t.energy})${t.unlocked ? "" : " [locked]"}${t.description ? ` — ${t.description.slice(0, 120)}` : ""}`).join("\n") || "  None"}

RANKINGS / SCOUTER:
${(rankingsRes.data || []).map((r: any) => `  • ${r.display_name} [${r.rank}] Lv${r.level} GPR:${r.gpr} PVP:${r.pvp} (${r.influence})${r.is_self ? " ★self" : ""}`).join("\n") || "  None"}

COUNCIL MEMBERS:
${(councilsRes.data || []).map((c: any) => `  • ${c.name} — ${c.role} (${c.class})`).join("\n") || "  None"}

ALLIES:
${(alliesRes.data || []).map((a: any) => `  • ${a.name} (${a.relationship}, Lv${a.level}, aff:${a.affinity})`).join("\n") || "  None"}

RITUALS:
${(ritualsRes.data || []).map((r: any) => `  • ${r.name} [${r.type}] streak:${r.streak}${r.completed ? " ✓" : ""}`).join("\n") || "  None"}
═══ END APP CONTEXT ═══
` : "";

    // Files uploaded into this persona thread
    const attBlock = attachments.length > 0
      ? "\n═══ FILES UPLOADED TO THIS CONVERSATION ═══\n" +
        attachments.map((a: any) => {
          const status = a.processing_status === "done" ? "" : ` [${a.processing_status}]`;
          const txt = (a.extracted_text || "").slice(0, 6000);
          return `\n📎 ${a.file_name} (${a.mime_type})${status}\n${txt || "(no extracted content yet)"}\n---`;
        }).join("") + "\n═══ END FILES ═══\n"
      : "";

    const systemPrompt = buildSystemPrompt(persona, relState, memoryContext) + appCtx + attBlock;

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
