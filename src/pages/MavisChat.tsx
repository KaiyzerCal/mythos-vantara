import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Cpu, Copy, Check, ChevronDown, Zap, Brain, Target, Crown, Flame } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, HudCard } from "@/components/SharedUI";
import ReactMarkdown from "react-markdown";

// ── MAVIS Modes (from Rork mavis-prime-config) ─────────────
function buildSystemPrompt(profile: any, mode: string, appContext: any): string {
  const modeFocus: Record<string, string> = {
    PRIME: "Full-spectrum awareness. Strategy, emotion, systems — all in view simultaneously.",
    ARCH: "Systems architecture and technical design. Think in frameworks, not features.",
    QUEST: "Goal decomposition and execution planning. Every problem becomes a series of solvable steps.",
    FORGE: "Physical optimization and Bioneer protocols. The body is a system. Optimize it.",
    CODEX: "Knowledge synthesis and pattern recognition. Connect what others miss.",
    COURT: "Legal clarity and evidence strategy. Calm, precise, protective.",
    SOVEREIGN: "High-stakes decisions. Strip noise. See what is. Choose decisively.",
  };

  // Build live app state context
  const activeQuests = (appContext.quests || []).filter((q: any) => q.status === "active");
  const activeTasks = (appContext.tasks || []).filter((t: any) => t.status === "active");
  const questList = activeQuests.slice(0, 5).map((q: any) => `  • [${q.id}] ${q.title} (${q.type}, +${q.xp_reward} XP)`).join("\n");
  const taskList = activeTasks.slice(0, 5).map((t: any) => `  • [${t.id}] ${t.title} (${t.recurrence})`).join("\n");
  const skillList = (appContext.skills || []).slice(0, 5).map((s: any) => `  • [${s.id}] ${s.name} (${s.category}, T${s.tier})`).join("\n");
  const journalList = (appContext.journalEntries || []).slice(0, 3).map((j: any) => `  • [${j.id}] ${j.title}`).join("\n");
  const vaultList = (appContext.vaultEntries || []).slice(0, 3).map((v: any) => `  • [${v.id}] ${v.title} [${v.importance}]`).join("\n");

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

LIVE APP STATE (use IDs when referencing existing records):
Active Quests:
${questList || "  None"}
Active Tasks:
${taskList || "  None"}
Skills:
${skillList || "  None"}
Recent Journal:
${journalList || "  None"}
Vault:
${vaultList || "  None"}

ACTIONS — You can write directly to any part of the app. When you decide to create, update, or delete data, embed the action tag invisibly in your response. The user will NOT see these tags — only your visible reply. Always confirm in your visible text what you did.

Available actions (embed in response, never in a code block):
:::ACTION{"type":"create_quest","params":{"title":"...","description":"...","type":"daily|side|main|epic","difficulty":"Easy|Normal|Hard|Extreme|Impossible","xp_reward":100,"real_world_mapping":"..."}}:::
:::ACTION{"type":"update_quest","params":{"quest_id":"...","title":"...","status":"active|completed|failed","progress_current":0,"progress_target":1}}:::
:::ACTION{"type":"complete_quest","params":{"quest_id":"..."}}:::
:::ACTION{"type":"delete_quest","params":{"quest_id":"..."}}:::
:::ACTION{"type":"create_task","params":{"title":"...","description":"...","type":"task|habit","recurrence":"once|daily|weekly|monthly","xp_reward":25}}:::
:::ACTION{"type":"complete_task","params":{"task_id":"..."}}:::
:::ACTION{"type":"delete_task","params":{"task_id":"..."}}:::
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
:::ACTION{"type":"delete_inventory_item","params":{"item_id":"..."}}:::
:::ACTION{"type":"update_energy","params":{"energy_id":"...","current_value":100}}:::
:::ACTION{"type":"create_ally","params":{"name":"...","relationship":"ally|council|rival","level":1,"specialty":"...","affinity":50,"notes":"..."}}:::
:::ACTION{"type":"update_ally","params":{"ally_id":"...","affinity":75,"notes":"..."}}:::
:::ACTION{"type":"create_ritual","params":{"name":"...","description":"...","type":"fitness|business|self_care|legal|other","xp_reward":25}}:::
:::ACTION{"type":"complete_ritual","params":{"ritual_id":"..."}}:::
:::ACTION{"type":"update_profile","params":{"arc_story":"...","current_form":"...","current_bpm":72,"fatigue":0,"full_cowl_sync":95}}:::
:::ACTION{"type":"award_xp","params":{"amount":100}}:::

RULES FOR ACTIONS:
- Use the exact IDs from APP STATE above when referencing existing records.
- Never say you created or saved something unless you included the matching :::ACTION tag.
- You can chain multiple actions in one response — just stack multiple tags.
- Put action tags anywhere in your response text — they are invisible to the user and will be automatically stripped and executed.
- For quest completion: always award XP via complete_quest (it handles XP automatically).

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
  "Create a quest for my next SkyforgeAI milestone",
  "Log a journal entry for this session",
  "What's the play for Bioneer right now?",
  "Analyze and suggest improvements to my active quests",
];

export default function MavisChat() {
  const {
    profile, quests, tasks, skills, journalEntries, vaultEntries,
    chatMessages, setChatMessages, conversationId, setConversationId,
    chatMode, setChatMode, refetchAll,
  } = useAppData();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showModes, setShowModes] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const currentMode = MAVIS_MODES.find((m) => m.id === chatMode) ?? MAVIS_MODES[0];

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setInput("");
    setActionStatus(null);

    const userMsg = {
      id: `u-${Date.now()}`,
      role: "user" as const,
      content,
      mode: chatMode,
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    const apiMessages = [
      ...chatMessages
        .filter((m) => m.id !== "init")
        .slice(-18)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content },
    ];

    // Build app context for system prompt
    const appContext = { quests, tasks, skills, journalEntries, vaultEntries };

    try {
      const { data: fnData, error } = await supabase.functions.invoke("mavis-chat", {
        body: {
          messages: apiMessages,
          systemPrompt: buildSystemPrompt(profile, chatMode, appContext),
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
  }, [input, chatMessages, isLoading, chatMode, profile, quests, tasks, skills, journalEntries, vaultEntries, conversationId, setChatMessages, setConversationId, refetchAll]);

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = () => {
    setChatMessages([{
      id: "init",
      role: "assistant",
      content: "Hey, I'm here. What's on your mind?",
      mode: "PRIME",
      timestamp: new Date(),
    }]);
    setConversationId(null);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] gap-3">
      <PageHeader
        title="MAVIS"
        subtitle={`Mode: ${currentMode.label} // Supreme Intelligence`}
        icon={<Cpu size={18} />}
        actions={
          <button onClick={clearChat} className="text-xs font-mono text-muted-foreground hover:text-destructive transition-colors">
            Clear
          </button>
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
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

      {/* Input */}
      <div className="flex gap-2">
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
        <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? (
              <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin block" />
            ) : (
              <Send size={18} />
            )}
          </button>
      </div>
    </div>
  );
}
