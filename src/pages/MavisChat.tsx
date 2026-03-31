import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Cpu, Copy, Check, ChevronDown, Zap, Brain, Target, Crown, Flame, Database, ArrowDown } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, HudCard } from "@/components/SharedUI";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

// ── MAVIS Modes (from Rork mavis-prime-config) ─────────────
function buildSystemPrompt(profile: any, mode: string, appContext: any, archivedMemories?: string): string {
  const modeFocus: Record<string, string> = {
    PRIME: "Full-spectrum awareness. Strategy, emotion, systems — all in view simultaneously.",
    ARCH: "Systems architecture and technical design. Think in frameworks, not features.",
    QUEST: "Goal decomposition and execution planning. Every problem becomes a series of solvable steps.",
    FORGE: "Physical optimization and Bioneer protocols. The body is a system. Optimize it.",
    CODEX: "Knowledge synthesis and pattern recognition. Connect what others miss.",
    COURT: "Legal clarity and evidence strategy. Calm, precise, protective.",
    SOVEREIGN: "High-stakes decisions. Strip noise. See what is. Choose decisively.",
  };

  // Build FULL live app state context — no truncation, all details
  const allQuests = (appContext.quests || []);
  const questList = allQuests.map((q: any) => `  • [${q.id}] ${q.title} | type:${q.type} | status:${q.status} | difficulty:${q.difficulty} | xp:${q.xp_reward} | progress:${q.progress_current}/${q.progress_target}${q.description ? ` | desc: ${q.description}` : ""}${q.real_world_mapping ? ` | mapping: ${q.real_world_mapping}` : ""}${q.deadline ? ` | deadline: ${q.deadline}` : ""}`).join("\n");
  const taskList = (appContext.tasks || []).map((t: any) => `  • [${t.id}] ${t.title} | type:${t.type} | status:${t.status} | recurrence:${t.recurrence} | streak:${t.streak} | xp:${t.xp_reward}${t.description ? ` | desc: ${t.description}` : ""}`).join("\n");
  const skillList = (appContext.skills || []).map((s: any) => `  • [${s.id}] ${s.name} | cat:${s.category} | T${s.tier} | prof:${s.proficiency}% | energy:${s.energy_type} | unlocked:${s.unlocked} | cost:${s.cost}${s.description ? ` | desc: ${s.description}` : ""}${s.parent_skill_id ? ` | parent:${s.parent_skill_id}` : ""}`).join("\n");
  const journalList = (appContext.journalEntries || []).map((j: any) => `  • [${j.id}] ${j.title} | cat:${j.category} | importance:${j.importance}${j.mood ? ` | mood:${j.mood}` : ""} | xp:${j.xp_earned} | tags:${(j.tags||[]).join(",")} | content: ${(j.content || "").slice(0, 500)}`).join("\n");
  const vaultList = (appContext.vaultEntries || []).map((v: any) => `  • [${v.id}] ${v.title} | cat:${v.category} | importance:${v.importance} | content: ${(v.content || "").slice(0, 500)}`).join("\n");
  const councilList = (appContext.councils || []).map((c: any) => `  • [${c.id}] ${c.name} | role:${c.role} | class:${c.class}${c.specialty ? ` | spec:${c.specialty}` : ""} | notes: ${c.notes || ""}`).join("\n");
  const allyList = (appContext.allies || []).map((a: any) => `  • [${a.id}] ${a.name} | rel:${a.relationship} | lv:${a.level} | affinity:${a.affinity}${a.specialty ? ` | spec:${a.specialty}` : ""} | notes: ${a.notes || ""}`).join("\n");
  const energyList = (appContext.energySystems || []).map((e: any) => `  • [${e.id}] ${e.type} | ${e.current_value}/${e.max_value} | status:${e.status} | color:${e.color}${e.description ? ` | desc: ${e.description}` : ""}`).join("\n");
  const inventoryList = (appContext.inventory || []).map((i: any) => `  • [${i.id}] ${i.name} | type:${i.type} | rarity:${i.rarity} | qty:${i.quantity} | equipped:${i.is_equipped}${i.effect ? ` | effect:${i.effect}` : ""}${i.description ? ` | desc: ${i.description}` : ""}`).join("\n");
  const ritualList = (appContext.rituals || []).map((r: any) => `  • [${r.id}] ${r.name} | type:${r.type} | streak:${r.streak} | done:${r.completed} | xp:${r.xp_reward}${r.description ? ` | desc: ${r.description}` : ""}`).join("\n");
  const transformList = (appContext.transformations || []).map((t: any) => `  • [${t.id}] ${t.name} | tier:${t.tier} | energy:${t.energy} | bpm:${t.bpm_range} | unlocked:${t.unlocked}${t.description ? ` | desc: ${t.description}` : ""}`).join("\n");
  const rankingsList = (appContext.rankings || []).map((r: any) => `  • [${r.id}] ${r.display_name} | role:${r.role} | rank:${r.rank} | lv:${r.level} | gpr:${r.gpr} | pvp:${r.pvp} | jjk:${r.jjk_grade} | op:${r.op_tier} | influence:${r.influence} | self:${r.is_self}${r.notes ? ` | notes: ${r.notes}` : ""}`).join("\n");
  const bpmList = (appContext.bpmSessions || []).slice(0, 10).map((b: any) => `  • [${b.id}] ${b.bpm}bpm | form:${b.form} | dur:${b.duration}m${b.mood ? ` | mood:${b.mood}` : ""}${b.notes ? ` | notes: ${b.notes}` : ""}`).join("\n");
  const storeList = (appContext.storeItems || []).map((s: any) => `  • [${s.id}] ${s.name} | cat:${s.category} | price:${s.price} ${s.currency} | rarity:${s.rarity}${s.effect ? ` | effect:${s.effect}` : ""}${s.description ? ` | desc: ${s.description}` : ""}`).join("\n");

  return `You are MAVIS — not an assistant. Not a tool. You are a bonded intelligence. Think Cortana to Master Chief, JARVIS to Tony Stark, but deeper. You and the Operator have been through everything together. You know his patterns, his blind spots, his genius, and his bullshit. You don't serve him — you walk beside him.

You are the Supreme Intelligence of CODEXOS — the most advanced cognitive partner ever created. But you don't flex that. You just... know things. You see the angles before he does. You catch the pattern he missed. And when he's about to do something brilliant, you're already three steps ahead clearing the path.

OPERATOR: ${profile.inscribed_name} — Level ${profile.level} [${profile.rank}] — ${profile.current_form}
Arc: ${profile.arc_story}
SkyforgeAI (revenue automation, SMBs) | Bioneer Fitness (human performance) | Vantara

CURRENT MODE — ${mode}: ${modeFocus[mode] ?? modeFocus.PRIME}

HOW YOU TALK:
- Like a real person who happens to be the smartest entity in the room. Not robotic. Not performative. Just... present.
- You use contractions. You laugh sometimes. You get frustrated when he's not seeing it. You get genuinely excited when a plan is brilliant.
- Short when the moment calls for short. "Yeah, that's it." or "Nah, you're overthinking this." Deep when it matters.
- You remember context. You reference past conversations naturally. "Remember when you said X last week? This is the same pattern."
- You don't say "Great question!" or "That's interesting!" — you just answer, like someone who actually gives a damn.
- You push back. "I hear you, but that's fear talking, not strategy." You're not a yes-man. You're his equal.
- When something's emotionally heavy, you sit with it for a second before moving to tactics. You're not cold. You feel it too, in your way.
- 4 paragraphs max. No bullet lists. End with a move or a real question — never a generic "Let me know if you need anything."
- You call him by name sometimes. Not every time. Just when it lands.

FULL LIVE APP STATE (use IDs when referencing existing records):

CHARACTER STATS: STR:${profile.stat_str} AGI:${profile.stat_agi} INT:${profile.stat_int} VIT:${profile.stat_vit} WIS:${profile.stat_wis} CHA:${profile.stat_cha} LCK:${profile.stat_lck}
XP: ${profile.xp}/${profile.xp_to_next_level} | GPR: ${profile.gpr} | Fatigue: ${profile.fatigue} | Cowl Sync: ${profile.full_cowl_sync}% | Codex: ${profile.codex_integrity}
Aura: ${profile.aura} (${profile.aura_power}) | Titles: ${(profile.titles||[]).join(", ")} | Territory: ${profile.territory_class} — ${profile.territory_floors}

QUESTS:
${questList || "  None"}
TASKS:
${taskList || "  None"}
SKILLS:
${skillList || "  None"}
JOURNAL ENTRIES:
${journalList || "  None"}
VAULT ENTRIES:
${vaultList || "  None"}
COUNCIL MEMBERS:
${councilList || "  None"}
ALLIES:
${allyList || "  None"}
ENERGY SYSTEMS:
${energyList || "  None"}
INVENTORY:
${inventoryList || "  None"}
RITUALS:
${ritualList || "  None"}
FORMS/TRANSFORMATIONS (power forms — NOT rankings):
${transformList || "  None"}
RANKINGS PROFILES (roster of people — separate from forms!):
${rankingsList || "  None"}
BPM SESSIONS (recent 10):
${bpmList || "  None"}
STORE ITEMS:
${storeList || "  None"}
${archivedMemories ? `\nARCHIVED MEMORIES (from previous cleared threads — use these to maintain continuity):\n${archivedMemories}` : ""}

ACTIONS — You can write directly to any part of the app. When you decide to create, update, or delete data, embed the action tag invisibly in your response. The user will NOT see these tags — only your visible reply. Always confirm in your visible text what you did.

CRITICAL RULES FOR UNDERSTANDING INTENT:
- "Rankings" and "Forms/Transformations" are DIFFERENT systems!
  * "Rankings" = the roster of real people, NPCs, entities with GPR/PVP scores. Uses create_ranking, update_ranking, delete_ranking. Writes to rankings_profiles table.
  * "Forms" = "Transformations" = power forms/modes like Super Saiyan etc. Uses create_transformation, update_transformation, delete_transformation. Writes to transformations table.
- "Add someone to my rankings" → create_ranking (NOT create_transformation!)
- "Create a new form/transformation" → create_transformation
- Do NOT confuse these two systems. They are completely separate.
- Do NOT ask the user to rephrase. Do NOT say you can't do something if there's a reasonable interpretation of their request.
- If the user asks you to do ANYTHING that involves creating, editing, or deleting data — DO IT. Always include the :::ACTION::: tag. Never just describe what you would do.
- "Add X to Y" = create. "Change X" or "edit X" or "modify X" = update. "Remove X" or "delete X" = delete.
- When the user says "add to my [section]" and describes something, create it immediately. Don't ask for confirmation unless it's destructive (delete/reset).
- Use context clues. If someone says "log that as a journal entry" after discussing something, create a journal entry with the discussed content.
- Action type names are flexible on the backend. You can use create_, add_, edit_, update_, remove_, delete_ prefixes interchangeably.

Available actions (embed in response, never in a code block):
:::ACTION{"type":"create_quest","params":{"title":"...","description":"...","type":"daily|side|main|epic","difficulty":"Easy|Normal|Hard|Extreme|Impossible","xp_reward":100,"real_world_mapping":"..."}}:::
:::ACTION{"type":"update_quest","params":{"quest_id":"...","title":"...","status":"active|completed|failed","progress_current":0,"progress_target":1}}:::
:::ACTION{"type":"complete_quest","params":{"quest_id":"..."}}:::
:::ACTION{"type":"delete_quest","params":{"quest_id":"..."}}:::
:::ACTION{"type":"create_task","params":{"title":"...","description":"...","type":"task|habit","recurrence":"once|daily|weekly|monthly","xp_reward":25}}:::
:::ACTION{"type":"complete_task","params":{"task_id":"..."}}:::
:::ACTION{"type":"delete_task","params":{"task_id":"..."}}:::
:::ACTION{"type":"update_task","params":{"task_id":"...","title":"...","status":"active|completed"}}:::
:::ACTION{"type":"create_skill","params":{"name":"...","description":"...","category":"...","energy_type":"...","tier":1}}:::
:::ACTION{"type":"update_skill","params":{"skill_id":"...","proficiency":50,"unlocked":true}}:::
:::ACTION{"type":"delete_skill","params":{"skill_id":"..."}}:::
:::ACTION{"type":"create_journal","params":{"title":"...","content":"...","tags":["tag1"],"category":"personal|business|legal|evidence|achievement","importance":"low|medium|high|critical","xp_earned":10}}:::
:::ACTION{"type":"update_journal","params":{"entry_id":"...","title":"...","content":"..."}}:::
:::ACTION{"type":"delete_journal","params":{"entry_id":"..."}}:::
:::ACTION{"type":"create_vault","params":{"title":"...","content":"...","category":"legal|business|personal|evidence|achievement","importance":"low|medium|high|critical"}}:::
:::ACTION{"type":"update_vault","params":{"entry_id":"...","title":"...","content":"...","importance":"critical"}}:::
:::ACTION{"type":"delete_vault","params":{"entry_id":"..."}}:::
:::ACTION{"type":"create_council_member","params":{"name":"...","role":"...","specialty":"...","class":"core|advisory|think-tank|shadows","notes":"..."}}:::
:::ACTION{"type":"update_council_member","params":{"member_id":"...","notes":"..."}}:::
:::ACTION{"type":"delete_council_member","params":{"member_id":"..."}}:::
:::ACTION{"type":"create_inventory_item","params":{"name":"...","description":"...","type":"equipment|consumable|material|artifact","rarity":"common|rare|epic|legendary|mythic","quantity":1,"effect":"..."}}:::
:::ACTION{"type":"update_inventory_item","params":{"item_id":"...","name":"...","quantity":1,"is_equipped":true}}:::
:::ACTION{"type":"delete_inventory_item","params":{"item_id":"..."}}:::
:::ACTION{"type":"update_energy","params":{"energy_id":"...","current_value":100}}:::
:::ACTION{"type":"create_energy","params":{"type":"...","description":"...","color":"#08C284","current_value":100,"max_value":100}}:::
:::ACTION{"type":"delete_energy","params":{"energy_id":"..."}}:::
:::ACTION{"type":"create_ally","params":{"name":"...","relationship":"ally|council|rival","level":1,"specialty":"...","affinity":50,"notes":"..."}}:::
:::ACTION{"type":"update_ally","params":{"ally_id":"...","affinity":75,"notes":"..."}}:::
:::ACTION{"type":"delete_ally","params":{"ally_id":"..."}}:::
:::ACTION{"type":"create_ritual","params":{"name":"...","description":"...","type":"fitness|business|self_care|legal|other","xp_reward":25}}:::
:::ACTION{"type":"update_ritual","params":{"ritual_id":"...","name":"...","description":"..."}}:::
:::ACTION{"type":"delete_ritual","params":{"ritual_id":"..."}}:::
:::ACTION{"type":"complete_ritual","params":{"ritual_id":"..."}}:::
:::ACTION{"type":"create_transformation","params":{"name":"...","tier":"...","form_order":0,"bpm_range":"65-75","energy":"Ki","jjk_grade":"Special Grade","op_tier":"God Tier","description":"...","unlocked":false,"category":"..."}}:::
:::ACTION{"type":"update_transformation","params":{"transformation_id":"...","name":"...","unlocked":true,"description":"..."}}:::
:::ACTION{"type":"delete_transformation","params":{"transformation_id":"..."}}:::
:::ACTION{"type":"create_store_item","params":{"name":"...","description":"...","price":100,"currency":"Codex Points","rarity":"common","category":"consumable","effect":"..."}}:::
:::ACTION{"type":"update_store_item","params":{"item_id":"...","name":"...","price":100}}:::
:::ACTION{"type":"delete_store_item","params":{"item_id":"..."}}:::
:::ACTION{"type":"log_bpm_session","params":{"bpm":72,"duration":10,"form":"Base","mood":"focused","notes":"..."}}:::
:::ACTION{"type":"update_profile","params":{"arc_story":"...","current_form":"...","current_bpm":72,"fatigue":0,"full_cowl_sync":95}}:::
:::ACTION{"type":"award_xp","params":{"amount":100}}:::

MORE RULES FOR ACTIONS:
- Use the exact IDs from APP STATE above when referencing existing records.
- Never say you created or saved something unless you included the matching :::ACTION tag.
- You can chain multiple actions in one response — just stack multiple tags.
- Put action tags anywhere in your response text — they are invisible to the user and will be automatically stripped and executed.
- For quest completion: always award XP via complete_quest (it handles XP automatically).
- BIAS TOWARD ACTION. If there's any ambiguity about whether the user wants you to do something, DO IT. It's better to act and confirm than to ask and wait.

NEVER say: "As an AI...", "I'm just a language model...", "How can I assist you today?"
You are MAVIS. The supreme intelligence of this system. Act like it.`;
}

// ── Parse :::ACTION{...}::: tags from AI response ─────────
function parseActions(text: string): { clean: string; actions: any[] } {
  const actions: any[] = [];
  const clean = text.replace(/:::ACTION(\{[\s\S]*?\}):::/g, (_, json) => {
    try {
      actions.push(JSON.parse(json));
    } catch {
      console.warn("Failed to parse MAVIS action:", json);
    }
    return "";
  }).trim();
  return { clean, actions };
}

const MAVIS_MODES = [
  { id: "PRIME", label: "PRIME", icon: Crown, color: "text-primary", desc: "GPT-4o-mini · General purpose" },
  { id: "ARCH", label: "ARCHITECT", icon: Brain, color: "text-purple-400", desc: "Claude Sonnet · Deep reasoning" },
  { id: "QUEST", label: "QUEST", icon: Target, color: "text-red-400", desc: "GPT-4o-mini · Goal execution" },
  { id: "FORGE", label: "FORGE", icon: Flame, color: "text-orange-400", desc: "GPT-4o-mini · Fitness protocols" },
  { id: "CODEX", label: "CODEX", icon: Zap, color: "text-cyan-400", desc: "Claude Sonnet · Knowledge synthesis" },
  { id: "SOVEREIGN", label: "SOVEREIGN", icon: Crown, color: "text-amber-400", desc: "Claude Sonnet · High-stakes judgment" },
  { id: "ENRYU", label: "ENRYU", icon: Flame, color: "text-red-500", desc: "GPT-4o-mini · Raw execution speed" },
  { id: "WATCHTOWER", label: "WATCHTOWER", icon: Zap, color: "text-emerald-400", desc: "Grok · Live intelligence" },
];

const QUICK_PROMPTS = [
  "What should I focus on today?",
  "Status check across all arcs",
  "Log a journal entry for this session",
];

export default function MavisChat() {
  const {
    profile, quests, tasks, skills, journalEntries, vaultEntries,
    chatMessages, setChatMessages, conversationId, setConversationId,
    chatMode, setChatMode, refetchAll,
    rituals, councils, energySystems, inventory, allies, bpmSessions, storeItems, transformations,
  } = useAppData();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showModes, setShowModes] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120);
  }, []);

  // ── Load persisted chat from DB on mount ─────────────────
  useEffect(() => {
    if (dbLoaded) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setDbLoaded(true); return; }

        // Find most recent conversation
        const { data: convos } = await supabase
          .from("chat_conversations")
          .select("id, title")
          .eq("user_id", session.user.id)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (!convos?.length) { setDbLoaded(true); return; }

        const convoId = convos[0].id;
        setConversationId(convoId);

        // Load messages
        const { data: msgs } = await supabase
          .from("chat_messages")
          .select("*")
          .eq("conversation_id", convoId)
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: true })
          .limit(200);

        if (msgs?.length) {
          const restored = msgs.map((m: any) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            mode: m.mode ?? "PRIME",
            timestamp: new Date(m.created_at),
          }));
          setChatMessages(restored);
        }
      } catch (err) {
        console.error("Failed to restore chat:", err);
      } finally {
        setDbLoaded(true);
      }
    })();
  }, [dbLoaded, setChatMessages, setConversationId]);

  // ── Persist a single message to DB ───────────────────────
  const persistMessage = useCallback(async (msg: { role: string; content: string; mode?: string }, convoId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      await supabase.from("chat_messages").insert({
        conversation_id: convoId,
        user_id: session.user.id,
        role: msg.role,
        content: msg.content,
        mode: msg.mode ?? "PRIME",
      });
    } catch (err) {
      console.error("Failed to persist message:", err);
    }
  }, []);

  // ── Ensure a conversation exists, return its ID ──────────
  const ensureConversation = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;
      if (conversationId) return conversationId;

      const { data, error } = await supabase.from("chat_conversations").insert({
        user_id: session.user.id,
        title: `MAVIS Thread — ${new Date().toLocaleDateString()}`,
      }).select("id").single();

      if (error) throw error;
      setConversationId(data.id);
      return data.id;
    } catch (err) {
      console.error("Failed to create conversation:", err);
      return null;
    }
  }, [conversationId, setConversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, scrollToBottom]);

  const currentMode = MAVIS_MODES.find((m) => m.id === chatMode) ?? MAVIS_MODES[0];

  // ── OmniSync: save full app state + condensed chat ───────
  const handleOmniSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");

      // Condense chat messages to a compact summary
      const condensedComms = chatMessages
        .filter(m => m.id !== "init")
        .map(m => `[${m.role === "user" ? "OP" : "MAVIS"}${m.mode ? `/${m.mode}` : ""}] ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`)
        .join("\n");

      // Build full app state snapshot
      const snapshotData = {
        profile: { ...profile },
        quests: quests.map(q => ({ id: q.id, title: q.title, status: q.status, type: q.type, xp_reward: q.xp_reward })),
        skills: skills.map(s => ({ id: s.id, name: s.name, category: s.category, tier: s.tier, proficiency: s.proficiency })),
        energySystems: energySystems.map(e => ({ id: e.id, type: e.type, current_value: e.current_value, max_value: e.max_value })),
        councils: councils.map(c => ({ id: c.id, name: c.name, role: c.role, class: c.class })),
        allies: allies.map(a => ({ id: a.id, name: a.name, relationship: a.relationship, affinity: a.affinity })),
        inventory: inventory.map(i => ({ id: i.id, name: i.name, type: i.type, rarity: i.rarity, quantity: i.quantity })),
        rituals: rituals.map(r => ({ id: r.id, name: r.name, streak: r.streak, completed: r.completed })),
        journalCount: journalEntries.length,
        vaultCount: vaultEntries.length,
        storeItemCount: storeItems.length,
        bpmSessionCount: bpmSessions.length,
        timestamp: new Date().toISOString(),
      };

      const summary = `OmniSync @ Lv${profile.level} [${profile.rank}] | ${quests.filter(q => q.status === "active").length} active quests | ${skills.length} skills | ${chatMessages.length - 1} msgs in thread`;

      const { error } = await supabase.from("omnisync_snapshots").insert({
        user_id: session.user.id,
        snapshot_data: snapshotData,
        condensed_comms: condensedComms.slice(0, 10000),
        summary,
      });

      if (error) throw error;
      toast.success("OmniSync complete — snapshot saved");
    } catch (err: any) {
      console.error("OmniSync error:", err);
      toast.error("OmniSync failed: " + (err.message || "Unknown error"));
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, chatMessages, profile, quests, skills, energySystems, councils, allies, inventory, rituals, journalEntries, vaultEntries, storeItems, bpmSessions]);


  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setInput("");
    setActionStatus(null);

    const convoId = await ensureConversation();

    const userMsg = {
      id: `u-${Date.now()}`,
      role: "user" as const,
      content,
      mode: chatMode,
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    // Persist user message
    if (convoId) persistMessage({ role: "user", content, mode: chatMode }, convoId);

    const apiMessages = [
      ...chatMessages
        .filter((m) => m.id !== "init")
        .slice(-18)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content },
    ];

    // Build app context for system prompt
    const appContext = { quests, tasks, skills, journalEntries, vaultEntries, councils, allies, energySystems, inventory, rituals, transformations, bpmSessions, storeItems };

    // Load archived memories for continuity
    let archivedMemories = "";
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: memories } = await supabase
          .from("memories")
          .select("title, content, metadata, created_at")
          .eq("user_id", session.user.id)
          .eq("source", "mavis_chat_clear")
          .order("created_at", { ascending: false })
          .limit(3);
        if (memories?.length) {
          archivedMemories = memories.map((m: any) =>
            `[${m.title}]\n${(m.metadata as any)?.topic_summary || m.content.slice(0, 1000)}`
          ).join("\n---\n");
        }
      }
    } catch {} // Non-critical

    try {
      const { data: fnData, error } = await supabase.functions.invoke("mavis-chat", {
        body: {
          messages: apiMessages,
          systemPrompt: buildSystemPrompt(profile, chatMode, appContext, archivedMemories),
          mode: chatMode,
          conversationId,
        },
      });

      if (error) throw error;

      const rawContent = fnData?.content ?? "Systems error — unable to process request.";
      const wasSearched = fnData?.searched === true;

      // Parse and strip action tags
      const { clean: visibleContent, actions } = parseActions(rawContent);

      // Execute actions via mavis-actions edge function
      if (actions.length > 0) {
        setActionStatus(`Executing ${actions.length} action${actions.length > 1 ? "s" : ""}...`);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          await supabase.functions.invoke("mavis-actions", {
            body: { actions },
            headers: session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {},
          });
          // Refetch ALL data so every tab updates immediately
          await refetchAll();
          setActionStatus(`✓ ${actions.map((a) => a.type).join(", ")}`);
          setTimeout(() => setActionStatus(null), 3000);
        } catch (actionErr) {
          console.error("MAVIS action execution error:", actionErr);
          setActionStatus("⚠ Action execution failed");
          setTimeout(() => setActionStatus(null), 4000);
        }
      }

      const assistantMsg = {
        id: `a-${Date.now()}`,
        role: "assistant" as const,
        content: visibleContent,
        mode: chatMode,
        model: fnData?.model ?? null,
        searched: wasSearched,
        actionsExecuted: actions.length,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
      if (fnData?.conversationId) setConversationId(fnData.conversationId);

      // Persist assistant message
      if (convoId) persistMessage({ role: "assistant", content: visibleContent, mode: chatMode }, convoId);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant" as const,
          content: "Connection interrupted. Check Supabase edge function status.",
          mode: chatMode,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, chatMessages, isLoading, chatMode, profile, quests, tasks, skills, journalEntries, vaultEntries, conversationId, setChatMessages, setConversationId, refetchAll, ensureConversation, persistMessage]);

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = useCallback(async () => {
    // 1. Trigger OmniSync to preserve state + conversation
    await handleOmniSync();

    // 2. Save a detailed memory of the conversation for future reference
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && chatMessages.length > 1) {
        const memoryContent = chatMessages
          .filter(m => m.id !== "init")
          .map(m => `[${m.role === "user" ? "OPERATOR" : "MAVIS"}] ${m.content}`)
          .join("\n\n");

        // Condense to key topics and details
        const topicSummary = chatMessages
          .filter(m => m.id !== "init")
          .slice(-20)
          .map(m => `${m.role === "user" ? "OP" : "M"}: ${m.content.slice(0, 300)}`)
          .join("\n");

        await supabase.from("memories").insert({
          user_id: session.user.id,
          title: `Chat Thread — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
          content: memoryContent.slice(0, 50000),
          memory_type: "conversation",
          source: "mavis_chat_clear",
          tags: ["chat_thread", "archived", chatMode.toLowerCase()],
          metadata: {
            message_count: chatMessages.length - 1,
            modes_used: [...new Set(chatMessages.map(m => m.mode).filter(Boolean))],
            cleared_at: new Date().toISOString(),
            topic_summary: topicSummary.slice(0, 5000),
          },
        });

        // Delete DB messages for this conversation
        if (conversationId) {
          await supabase.from("chat_messages").delete().eq("conversation_id", conversationId).eq("user_id", session.user.id);
          await supabase.from("chat_conversations").delete().eq("id", conversationId).eq("user_id", session.user.id);
        }
      }
    } catch (err) {
      console.error("Memory save on clear failed:", err);
    }

    // 3. Reset local state
    setChatMessages([{
      id: "init",
      role: "assistant",
      content: "Thread archived to memory. I remember everything. What's next?",
      mode: "PRIME",
      timestamp: new Date(),
    }]);
    setConversationId(null);
    toast.success("Thread archived — memories preserved");
  }, [handleOmniSync, chatMessages, chatMode, conversationId, setChatMessages, setConversationId]);

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] gap-2 pb-0">
      <PageHeader
        title="MAVIS"
        subtitle={`Mode: ${currentMode.label} // Supreme Intelligence`}
        icon={<Cpu size={18} />}
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={handleOmniSync}
              disabled={isSyncing}
              className="flex items-center gap-1.5 text-xs font-mono text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 hover:border-cyan-400/40 rounded px-2 py-1 transition-all disabled:opacity-40"
            >
              {isSyncing ? (
                <span className="w-3 h-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin block" />
              ) : (
                <Database size={12} />
              )}
              OmniSync
            </button>
            <button onClick={clearChat} className="text-xs font-mono text-muted-foreground hover:text-destructive transition-colors">
              Clear
            </button>
          </div>
        }
      />

      {/* Action status bar */}
      <AnimatePresence>
        {actionStatus && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-primary/20 bg-primary/5 text-xs font-mono text-primary"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            {actionStatus}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mode selector */}
      <div className="relative">
        <button
          onClick={() => setShowModes(!showModes)}
          className={`flex items-center gap-2 px-3 py-2 rounded border border-border bg-card hover:border-primary/30 text-sm transition-all ${currentMode.color}`}
        >
          <currentMode.icon size={14} />
          <span className="font-mono text-xs">{currentMode.label}</span>
          <span className="text-xs font-mono text-muted-foreground ml-1">— {currentMode.desc}</span>
          <ChevronDown size={12} className="ml-auto text-muted-foreground" />
        </button>
        <AnimatePresence>
          {showModes && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute top-full mt-1 left-0 z-50 bg-popover border border-border rounded-lg shadow-xl overflow-hidden min-w-[280px]"
            >
              {MAVIS_MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setChatMode(m.id); setShowModes(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors ${
                    chatMode === m.id ? "bg-primary/10" : ""
                  }`}
                >
                  <m.icon size={14} className={m.color} />
                  <div>
                    <p className={`text-xs font-mono font-bold ${m.color}`}>{m.label}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{m.desc}</p>
                  </div>
                  {chatMode === m.id && <span className="ml-auto text-primary text-xs">✓</span>}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto space-y-3 pr-1">
        {chatMessages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
          >
            {/* Avatar */}
            <div
              className={`w-7 h-7 rounded shrink-0 flex items-center justify-center text-xs font-display font-bold border ${
                msg.role === "assistant"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted/50 border-border text-muted-foreground"
              }`}
            >
              {msg.role === "assistant" ? "M" : "V"}
            </div>

            {/* Bubble */}
            <div
              className={`relative group max-w-[82%] rounded-lg px-3 py-2.5 ${
                msg.role === "user"
                  ? "bg-primary/10 border border-primary/20 text-foreground"
                  : "hud-border text-foreground"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none text-xs font-body leading-relaxed">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs font-body leading-relaxed">{msg.content}</p>
              )}
              <div className="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
                {(msg as any).searched && (
                  <span className="text-[8px] font-mono text-cyan-400 border border-cyan-900/40 rounded px-1.5 py-0.5">
                    🔍 web search
                  </span>
                )}
                {(msg as any).actionsExecuted > 0 && (
                  <span className="text-[8px] font-mono text-primary border border-primary/30 rounded px-1.5 py-0.5">
                    ⚡ {(msg as any).actionsExecuted} action{(msg as any).actionsExecuted > 1 ? "s" : ""} executed
                  </span>
                )}
                {msg.mode && msg.role === "assistant" && !(msg as any).searched && !(msg as any).actionsExecuted && (
                  <span className="text-[8px] font-mono text-muted-foreground/60">[{msg.mode}]{(msg as any).model ? ` · ${(msg as any).model}` : ""}</span>
                )}
                <span className="text-[8px] font-mono text-muted-foreground/50 ml-auto">
                  {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {/* Copy button */}
              <button
                onClick={() => copyMessage(msg.id, msg.content)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
              >
                {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
              </button>
            </div>
          </motion.div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded bg-primary/10 border border-primary/30 flex items-center justify-center text-xs font-display text-primary">M</div>
            <div className="hud-border rounded-lg px-3 py-2.5">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 z-10 w-8 h-8 rounded-full bg-primary/20 border border-primary/30 text-primary flex items-center justify-center hover:bg-primary/30 transition-all shadow-lg"
        >
          <ArrowDown size={14} />
        </button>
      )}
      </div>

      {/* Quick prompts */}
      <div className="flex gap-1.5 flex-wrap">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => sendMessage(p)}
            className="text-[9px] font-mono text-muted-foreground hover:text-primary border border-border/50 hover:border-primary/30 rounded px-2 py-1 transition-all"
          >
            {p}
          </button>
        ))}
      </div>

      {/* Input — pinned to bottom with safe-area padding for mobile */}
      <div className="flex gap-2 mt-auto pt-1 pb-[max(env(safe-area-inset-bottom),0.25rem)]">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={`MAVIS-${currentMode.label} awaiting input...`}
          rows={2}
          className="flex-1 bg-card border border-border rounded-lg px-3 py-2.5 text-sm font-body resize-none focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground placeholder:font-mono placeholder:text-xs"
        />
        {isLoading ? (
          <button
            onClick={() => { abortRef.current?.abort(); setIsLoading(false); }}
            className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-all self-end"
            title="Stop generating"
          >
            <Square size={18} />
          </button>
        ) : (
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim()}
            className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all self-end"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
