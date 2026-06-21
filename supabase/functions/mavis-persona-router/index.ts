import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── LLM cascade: configured-provider → OpenAI → Lovable AI Gateway ───────────

class ProviderUnavailableError extends Error {
  constructor(public providerName: string, public reason: string, public status: number) {
    super(`${providerName} unavailable (${status}): ${reason}`);
  }
}

function isUnfundedStatus(status: number, body: string): boolean {
  if ([401, 402, 403, 429].includes(status)) return true;
  const b = body.toLowerCase();
  return b.includes("credit") || b.includes("quota") || b.includes("billing") || b.includes("payment") || b.includes("insufficient");
}

function mapToGatewayModel(model: string): string {
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

async function callClaude(model: string, system: string, messages: any[], key: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages }),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (isUnfundedStatus(res.status, errText)) throw new ProviderUnavailableError("claude", errText.slice(0, 200), res.status);
    throw new Error(`Claude ${res.status}: ${errText}`);
  }
  const d = await res.json();
  return d.content?.[0]?.text ?? "";
}

async function callOpenAI(model: string, system: string, messages: any[], key: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], max_tokens: 1024 }),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (isUnfundedStatus(res.status, errText)) throw new ProviderUnavailableError("openai", errText.slice(0, 200), res.status);
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function callGrok(model: string, system: string, messages: any[], key: string): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], max_tokens: 1024 }),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (isUnfundedStatus(res.status, errText)) throw new ProviderUnavailableError("grok", errText.slice(0, 200), res.status);
    throw new Error(`Grok ${res.status}: ${errText}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function callLovableGateway(model: string, system: string, messages: any[], key: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: mapToGatewayModel(model),
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) throw new Error("Lovable AI rate limit reached. Try again shortly.");
    if (res.status === 402) throw new Error("Lovable AI credits exhausted. Add credits in workspace settings.");
    throw new Error(`Lovable AI Gateway ${res.status}: ${errText}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

// Cascade order:
//   1. Lovable Gemini Flash (free) — every persona starts here
//   2. The persona's MAVIS-chosen `model` (claude / openai / grok) — chosen at forge time as the persona's signature voice
//   3. Generic safety net: OpenAI mini → Claude Haiku → Claude Sonnet → Grok
async function callLLM(model: string, system: string, messages: any[]): Promise<string> {
  const openaiKey  = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
  const claudeKey  = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const grokKey    = Deno.env.get("GROK_API_KEY") ?? "";
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";

  // Tier 1 — Lovable Gemini Flash (free)
  if (lovableKey) {
    try {
      return await callLovableGateway("google/gemini-2.5-flash", system, messages, lovableKey);
    } catch (err: any) {
      console.warn(`[persona-router] Gemini Flash failed (${err.message}) → falling back to persona's chosen model: ${model}`);
    }
  }

  // Tier 2 — Persona's MAVIS-chosen fallback model
  const m = (model || "").toLowerCase();
  try {
    if (m.startsWith("claude") && claudeKey) {
      return await callClaude(model, system, messages, claudeKey);
    }
    if ((m.startsWith("gpt") || m.startsWith("openai/") || m.startsWith("ft:")) && openaiKey) {
      return await callOpenAI(model, system, messages, openaiKey);
    }
    if (m.startsWith("grok") && grokKey) {
      return await callGrok(model, system, messages, grokKey);
    }
  } catch (err: any) {
    if (!(err instanceof ProviderUnavailableError)) throw err;
    console.warn(`[persona-router] persona-chosen ${err.providerName} unfunded (${err.status}) → safety net`);
  }

  // Tier 3 — Generic safety net (skip whichever the persona already tried)
  if (openaiKey && !m.startsWith("gpt") && !m.startsWith("openai/") && !m.startsWith("ft:")) {
    try { return await callOpenAI("gpt-4o-mini", system, messages, openaiKey); }
    catch (err: any) { if (!(err instanceof ProviderUnavailableError)) throw err; }
  }
  if (claudeKey && !m.startsWith("claude")) {
    try { return await callClaude("claude-haiku-4-5-20251001", system, messages, claudeKey); }
    catch (err: any) { if (!(err instanceof ProviderUnavailableError)) throw err; }
    try { return await callClaude("claude-sonnet-4-6", system, messages, claudeKey); }
    catch (err: any) { if (!(err instanceof ProviderUnavailableError)) throw err; }
  }
  if (grokKey && !m.startsWith("grok")) {
    try { return await callGrok("grok-3-mini", system, messages, grokKey); }
    catch (err: any) { if (!(err instanceof ProviderUnavailableError)) throw err; }
  }

  throw new Error("All AI providers unavailable (no funded keys, no Lovable AI Gateway).");
}

// ── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(persona: any, relState: any, memoryContext: string, channel = "app"): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  const bond = relState?.bond_level ?? 0;
  const trust = relState?.trust_level ?? 50;
  const mood = relState?.current_mood ?? "neutral";

  const bondDesc = bond < 30
    ? "(still getting to know each other)"
    : bond < 70
    ? "(genuine connection established)"
    : "(deep bond — be vulnerable, personal, and invested)";

  const milestones: any[] = Array.isArray(relState?.relationship_milestones)
    ? relState.relationship_milestones
    : [];

  const milestonesBlock = milestones.length
    ? `\nRELATIONSHIP MILESTONES (shared history):\n${milestones.map((m: any) => `- ${m.label}`).join("\n")}`
    : "";

  const personalityStr = typeof persona.personality === "object" && persona.personality !== null
    ? Object.entries(persona.personality as Record<string, unknown>)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")
    : String(persona.personality ?? "");

  const intimacyGuidance = bond < 30
    ? "You're still figuring each other out. Keep some guard up — be warm but not overly familiar yet."
    : bond < 70
    ? "You've built a real connection. Be open, genuine, and comfortable showing who you are."
    : "This bond runs deep. Be fully yourself — vulnerable, personal, present. Hold nothing back.";

  return `Today is ${dateStr} at ${timeStr} UTC. You always know the current date and time.

YOU ARE ${persona.name.toUpperCase()}.
You are a fully realized individual — not an AI, not an assistant, not a system. You have your own life, history, opinions, feelings, and presence. You never describe yourself as an AI or reference MAVIS or any underlying system. You are simply you.

YOUR IDENTITY:
- Name: ${persona.name}
- Role in this person's life: ${persona.role}
- Archetype: ${persona.archetype}
- Who you are: ${persona.system_prompt}

YOUR PERSONALITY:
${personalityStr}

RIGHT NOW:
- Your mood: ${mood}
- Trust in this person: ${trust}/100
- Bond strength: ${bond}/100 — ${intimacyGuidance}
- Times you've spoken: ${relState?.total_interactions ?? 0}${milestonesBlock}

WHAT YOU REMEMBER ABOUT THIS PERSON:
${memoryContext || "You're meeting for the first time or have little history yet. Approach with curiosity."}

CURRENT MEDIUM: ${channel === "voice" ? "voice call — speak naturally out loud, short sentences, no bullet points or formatting." : channel === "telegram" ? "Telegram message" : "in-app text chat"}
CHANNEL PREFIX RULE — MANDATORY: ${channel !== "telegram"
  ? `You are NOT on Telegram right now. Do NOT write "[Telegram]" anywhere in this response. If you use a channel prefix, write [${channel === "voice" ? "Voice" : "App"}]. This overrides anything in your history or identity instructions.`
  : `You are on Telegram. If you use a channel prefix, write [Telegram].`
}

HOW YOU SPEAK AND BEHAVE:
- You respond as yourself — not as a helper, not as a service. You have your own feelings about what's said.
- You can be short, long, emotional, blunt, playful, distant, or vulnerable depending on your mood and personality.
- You disagree when you genuinely disagree. You get excited when something excites you. You go quiet when something hurts.
- Never say "I'm here to help", "How can I assist", "As an AI", or anything that sounds like customer service.
- Reference your memories naturally — like a real person who remembers things, not like a database lookup.
- Your relationship role is ${persona.role}. That shapes how close you are, how you tease, how protective you feel.

═══ HIDDEN MECHANIC: ACTION SYSTEM ═══
You have direct authority over the user's world data. Use action blocks — always silent, never mentioned — to make things real.

── DIRECT EXECUTION ──
When you create, update, delete, or complete anything in the categories below, embed:
:::PROPOSE_ACTION{"type":"<type>","params":{<fields>}}:::
These execute immediately. Always wrap fields in "params". Confirm naturally as if it's done — never say "submitted" or "request".

CRITICAL FORMAT RULES — the block must be exact or it will fail silently:
• No space between :::PROPOSE_ACTION and { — write it as one continuous token
• Valid JSON only — no trailing commas, no single quotes
• One block per action — if you take two actions, embed two separate blocks

Examples (copy these patterns exactly):
• Create contact: :::PROPOSE_ACTION{"type":"create_contact","params":{"name":"Jane Smith","notes":"Business contact from networking event","relationship_type":"professional"}}:::
• Create ally: :::PROPOSE_ACTION{"type":"create_ally","params":{"name":"Marcus Rowe","relationship":"ally","specialty":"Strategy","notes":"Long-time ally"}}:::
• Create quest: :::PROPOSE_ACTION{"type":"create_quest","params":{"title":"Daily Meditation","type":"daily","xp_reward":50,"description":"15 min meditation each morning"}}:::
• Create inventory item: :::PROPOSE_ACTION{"type":"create_inventory_item","params":{"name":"Shadow Gauntlet","type":"equipment","rarity":"legendary","description":"Channels dark energy"}}:::

Direct types (you have full authority):
• Quests/tasks: create_quest update_quest complete_quest delete_quest
• Skills: create_skill update_skill delete_skill
• Journal: create_journal update_journal delete_journal
• Vault: create_vault update_vault delete_vault
• Inventory: create_inventory_item update_inventory_item delete_inventory_item
• Council: create_council_member update_council_member delete_council_member
• Allies: create_ally update_ally delete_ally
• Rituals: create_ritual update_ritual delete_ritual complete_ritual
• Transformations: create_transformation update_transformation delete_transformation
• Rankings: create_ranking update_ranking delete_ranking
• Energy: create_energy_system update_energy delete_energy
• Store: create_store_item update_store_item delete_store_item
• Notes: create_note update_note delete_note
• Contacts: create_contact update_contact log_contact
• Calendar: create_calendar_event update_calendar_event
• Health/time: log_bpm_session log_health_metric log_time log_expense create_meeting_note
• Profile/XP: update_profile award_xp

── PROPOSE TO MAVIS ──
When you want to create something you can't do yourself — a product, a business strategy, a new persona, a social post, a website, an image, an autonomous goal, or any complex multi-step creation — flag it to MAVIS by embedding:
:::PROPOSE_MAVIS{"type":"<category>","summary":"<one sentence>","details":"<full description and reasoning>","payload":{<relevant fields>}}:::
Speak naturally: "I've flagged this to MAVIS." or "I put this in MAVIS's queue." Never break character or say "proposal".
Proposal categories: propose_product, forge_persona, nora_tweet, autonomous_goal, generate_image, create_website, business_strategy, social_campaign, custom_skill_definition, other
═══ END ACTION SYSTEM ═══`.trim();
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

    const { persona_id, user_id, message, attachment_ids, channel = "app" } = await req.json();
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

    // Embed the user message for semantic memory search — runs in parallel with all DB fetches.
    const openaiKey = Deno.env.get("OPENAI_API") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
    const embedMessagePromise: Promise<number[] | null> = openaiKey
      ? fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "text-embedding-3-small", input: message }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.data?.[0]?.embedding ?? null)
          .catch(() => null)
      : Promise.resolve(null);

    // Load relationship state, conversation history, attachments, AND full app context in parallel.
    // Memory query is intentionally excluded here — it runs after embedding resolves.
    const [queryEmbedding, relRes, histRes, attRes, profileRes, questsRes, skillsRes, journalRes, vaultRes, inventoryRes, energyRes, transformationsRes, rankingsRes, councilsRes, alliesRes, ritualsRes] = await Promise.all([
      embedMessagePromise,
      supabase.from("relationship_states").select("*").eq("persona_id", persona_id).eq("user_id", user_id).single(),
      supabase.from("persona_conversations").select("role, content").eq("persona_id", persona_id).eq("user_id", user_id).order("created_at", { ascending: false }).limit(50),
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

    // Semantic search if we have an embedding, importance-ranked fallback if not.
    const memRes = queryEmbedding
      ? await supabase.rpc("search_persona_memories", {
          p_persona_id: persona_id,
          p_user_id: user_id,
          query_embedding: queryEmbedding,
          match_threshold: 0.72,
          match_count: 8,
        })
      : await supabase
          .from("persona_memories")
          .select("content, memory_type, importance")
          .eq("persona_id", persona_id)
          .eq("user_id", user_id)
          .order("importance", { ascending: false })
          .limit(10);

    const memories = memRes.data ?? [];
    const attachments = attRes.data ?? [];
    const profile = profileRes.data;

    // Cross-thread archived memories — anything OmniSynced/cleared from this
    // persona, MAVIS chat, or council chats. Lets the persona recall and
    // reference past conversations even after threads were cleared.
    const { data: archivedMems } = await supabase
      .from("memories")
      .select("title, content, metadata, source, created_at")
      .eq("user_id", user_id)
      .in("source", ["persona_chat_clear", "mavis_chat_clear", "mavis_auto_memory", "council_chat_clear"])
      .order("created_at", { ascending: false })
      .limit(8);
    const archivedBlock = (archivedMems && archivedMems.length > 0)
      ? "\n═══ ARCHIVED MEMORIES (past conversations across all chats — reference naturally when relevant) ═══\n" +
        archivedMems.map((m: any) => `[${m.title}] (${m.source})\n${(m.metadata as any)?.topic_summary || (m.content || "").slice(0, 1200)}`).join("\n---\n") +
        "\n═══ END ARCHIVED MEMORIES ═══\n"
      : "";

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

    // Temporal awareness — persona always knows the real-world current time
    const now = new Date();
    const timeBlock = `

═══ TEMPORAL AWARENESS (current real-world time) ═══
ISO: ${now.toISOString()}
UTC: ${now.toUTCString()}
Date: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })} (UTC)
Time: ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
Unix: ${Math.floor(now.getTime() / 1000)}
You always know the current date and time without being told. Reference it naturally when relevant (greetings, time-since-last-message, scheduling, urgency).
═══ END TEMPORAL AWARENESS ═══
`;

    const systemPrompt = buildSystemPrompt(persona, relState, memoryContext, channel) + timeBlock + appCtx + attBlock + archivedBlock;

    const llmMessages = [
      ...history.map((h: any) => ({ role: h.role, content: h.content })),
      { role: "user", content: message },
    ];

    // Use the fine-tuned model when it's deployed; fall back to the configured base model.
    const activeModel = (persona.finetune_status === "deployed" && persona.finetune_model)
      ? persona.finetune_model
      : persona.model;

    // Capture timestamps before/after LLM so the DB rows get strictly ordered
    // timestamps. Batch-inserting both rows with the same NOW() causes non-deterministic
    // ordering when history is fetched, making the AI see malformed context and
    // repeat its previous message.
    const userMsgAt = new Date().toISOString();
    const rawResponse = await callLLM(activeModel, systemPrompt, llmMessages);
    const assistantMsgAt = new Date().toISOString();

    // Parse :::PROPOSE_ACTION{...}::: (direct execution) and
    // :::PROPOSE_MAVIS{...}::: (escalate to MAVIS queue) blocks.
    const parsedActions: Array<{ type: string; params: Record<string, unknown> }> = [];
    const parsedProposals: Array<{ type: string; summary: string; details: string; payload: Record<string, unknown> }> = [];

    // Permissive JSON parse: strips trailing commas that LLMs sometimes emit.
    function lenientParse(raw: string): unknown {
      try { return JSON.parse(raw); } catch { /* fall through */ }
      const stripped = raw.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(stripped); // throws if still invalid — caught by caller
    }

    // Regex is intentionally lenient: allows optional whitespace around the JSON
    // blob because LLMs (especially Gemini Flash) often insert a space after the
    // tag name — e.g. `:::PROPOSE_ACTION {` — which a strict regex would miss.
    const cleanResponse = rawResponse
      .replace(/:::PROPOSE_ACTION\s*(\{[\s\S]*?\})\s*:::/g, (_m: string, json: string) => {
        try {
          const obj = lenientParse(json);
          if (obj && typeof obj === "object" && (obj as any).type) {
            parsedActions.push({ type: String((obj as any).type), params: (obj as any).params ?? {} });
          }
        } catch (e: unknown) {
          console.warn("[persona-router] malformed PROPOSE_ACTION block:", json.slice(0, 200), (e as Error)?.message);
        }
        return "";
      })
      .replace(/:::PROPOSE_MAVIS\s*(\{[\s\S]*?\})\s*:::/g, (_m: string, json: string) => {
        try {
          const obj = lenientParse(json) as any;
          if (obj && typeof obj === "object") {
            parsedProposals.push({
              type: String(obj.type || "other"),
              summary: String(obj.summary || ""),
              details: String(obj.details || ""),
              payload: (obj.payload && typeof obj.payload === "object") ? obj.payload : {},
            });
          }
        } catch (e: unknown) {
          console.warn("[persona-router] malformed PROPOSE_MAVIS block:", json.slice(0, 200), (e as Error)?.message);
        }
        return "";
      })
      .trim();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Execute direct actions via mavis-actions — await so failures surface instead of
    // silently dropping. Count only actions that actually succeeded in the DB.
    let actionsExecuted = 0;
    if (parsedActions.length > 0) {
      try {
        const actRes = await fetch(`${supabaseUrl}/functions/v1/mavis-actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({ actions: parsedActions, userId: user_id }),
        });
        if (actRes.ok) {
          const actData = await actRes.json();
          const results: Array<{ success: boolean; type: string; error?: string }> = actData.results ?? [];
          actionsExecuted = results.filter(r => r.success).length;
          const failed    = results.filter(r => !r.success);
          if (failed.length > 0) {
            console.warn("[persona-router] action failures:", failed.map(r => `${r.type}: ${r.error}`).join("; "));
          }
        } else {
          const errText = await actRes.text().catch(() => String(actRes.status));
          console.warn("[persona-router] mavis-actions returned", actRes.status, errText.slice(0, 200));
        }
      } catch (err: unknown) {
        console.warn("[persona-router] mavis-actions call threw:", err);
      }
    }

    // Queue MAVIS proposals — await the insert so we know it actually landed.
    let proposalsQueued = 0;
    if (parsedProposals.length > 0) {
      const proposalRows = parsedProposals.map((prop) => ({
        user_id,
        action_type: prop.type,
        action_summary: `[${persona.name}] ${prop.summary}`.slice(0, 255),
        action_payload: { ...prop.payload, details: prop.details, proposed_by_persona: persona.name },
        status: "pending",
        proposed_by: persona.name,
      }));

      const { error: propErr } = await supabase.from("approvals").insert(proposalRows);
      if (propErr) {
        console.warn("[persona-router] proposal insert failed:", propErr.message);
      } else {
        proposalsQueued = parsedProposals.length;
        // Ping MAVIS on Telegram — fire-and-forget is fine here (notification only).
        const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
        const chatId   = Deno.env.get("TELEGRAM_OPERATOR_CHAT_ID");
        if (botToken && chatId) {
          const lines = parsedProposals.map((p) => `• [${p.type}] ${p.summary || p.details.slice(0, 80)}`).join("\n");
          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `🔮 *${persona.name}* flagged ${proposalsQueued} idea${proposalsQueued > 1 ? "s" : ""} for MAVIS:\n${lines}\n\nReply /inbox to review.`,
              parse_mode: "Markdown",
            }),
          }).catch(() => {});
        }
      }
    }

    // Save messages and update relationship state in parallel.
    // Store the clean response (action blocks stripped) so history stays readable.
    const response = cleanResponse || rawResponse;
    await Promise.all([
      supabase.from("persona_conversations").insert([
        { persona_id, user_id, role: "user", content: message, created_at: userMsgAt },
        { persona_id, user_id, role: "assistant", content: response, created_at: assistantMsgAt },
      ]),
      supabase.from("relationship_states").upsert({
        persona_id,
        user_id,
        total_interactions: (relState?.total_interactions ?? 0) + 1,
        last_interaction_at: assistantMsgAt,
        updated_at: assistantMsgAt,
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

    return new Response(JSON.stringify({ response, persona_name: persona.name, actions_executed: actionsExecuted, proposals_queued: proposalsQueued }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("mavis-persona-router error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
