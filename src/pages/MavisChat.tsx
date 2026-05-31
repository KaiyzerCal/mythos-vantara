import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Cpu, Copy, Check, ChevronDown, Zap, Brain, Target, Crown, Flame, Database, Mic, MicOff, Users, Search, FileCode, X, Download, Gamepad2, Layers, Globe, ThumbsUp, ThumbsDown } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { PageHeader, HudCard } from "@/components/SharedUI";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { useElevenLabsTts } from "@/hooks/useElevenLabsTts";
import { useChatAttachments } from "@/hooks/useChatAttachments";
import { VoicePicker } from "@/components/chat/VoicePicker";
import { AttachmentTray, AttachButton } from "@/components/chat/AttachmentTray";
import { DEFAULT_VOICE_BY_GENDER, findVoice } from "@/lib/voiceCatalog";
import { ScrollProgressBar, BackToTopButton, ScrollToBottomButton, EndOfFeed } from "@/components/chat/ScrollKit";
import { SessionBlock, groupMessagesIntoSessions } from "@/components/chat/SessionBlock";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";

// ── MAVIS modules ───────────────────────────────────────────
import { buildSystemPromptFromSnapshot } from "@/mavis/buildSystemPrompt";
import { setDefaultHandler, registerActionHandler } from "@/mavis/actionExecutor";
import { streamChatMessage, streamAgentMessage, streamResearchMessage } from "@/mavis/chatService";
import { loadFullAppContext } from "@/mavis/appContextLoader";
import { initSession } from "@/mavis/memoryEngine";
import { loadRuntimeSkills } from "@/mavis/skills/_registry";
import { gatherProviderContext } from "@/mavis/contextProviders";
import { buildRecallContext } from "@/mavis/proactiveRecall";
import { captureProceduralMemory } from "@/mavis/proceduralMemory";
import { autoCrewDispatch } from "@/mavis/crewCoordinator";
import { getCustomOrders, addStandingOrder, removeStandingOrder } from "@/mavis/standingOrders";
import type { ExecutionResult } from "@/mavis/types";
// Trigger skill self-registration
import "@/mavis/skills/_loader";

const MAVIS_MODES = [
  { id: "PRIME",      label: "PRIME",      icon: Crown,    color: "text-primary",      desc: "GPT-4o-mini · General purpose" },
  { id: "ARCH",       label: "ARCHITECT",  icon: Brain,    color: "text-purple-400",   desc: "Claude Sonnet · Deep reasoning" },
  { id: "QUEST",      label: "QUEST",      icon: Target,   color: "text-red-400",      desc: "GPT-4o-mini · Goal execution" },
  { id: "FORGE",      label: "FORGE",      icon: Flame,    color: "text-orange-400",   desc: "GPT-4o-mini · Fitness protocols" },
  { id: "CODEX",      label: "CODEX",      icon: Zap,      color: "text-cyan-400",     desc: "Claude Sonnet · Knowledge synthesis" },
  { id: "SOVEREIGN",  label: "SOVEREIGN",  icon: Crown,    color: "text-amber-400",    desc: "Claude Sonnet · High-stakes judgment" },
  { id: "ENRYU",      label: "ENRYU",      icon: Flame,    color: "text-red-500",      desc: "GPT-4o-mini · Raw execution speed" },
  { id: "WATCHTOWER", label: "WATCHTOWER", icon: Zap,      color: "text-emerald-400",  desc: "Grok · Live intelligence" },
  { id: "AGENT",      label: "AGENT",      icon: Cpu,      color: "text-violet-400",   desc: "Claude Sonnet · Agentic tool-use loop" },
  { id: "RESEARCH",   label: "RESEARCH",   icon: Search,   color: "text-cyan-300",     desc: "Claude Sonnet · Deep multi-step research" },
  { id: "REFLECT",    label: "REFLECT",    icon: FileCode, color: "text-teal-400",     desc: "Claude Sonnet · Full system audit & review" },
  { id: "SALES",      label: "SALES",      icon: Users,    color: "text-green-400",    desc: "GPT-4o-mini · Pipeline & outreach intelligence" },
  { id: "MARKET",     label: "MARKET",     icon: Zap,      color: "text-pink-400",     desc: "GPT-4o-mini · Content & brand (Nora Vale)" },
  { id: "DATA",        label: "DATA",        icon: Database,  color: "text-blue-400",    desc: "Claude Sonnet · Metrics & analytics" },
  { id: "DEEP",        label: "DEEP",        icon: Layers,    color: "text-indigo-400",  desc: "Gemini 2.5 Flash · Extended thinking (8K budget)" },
  { id: "GAME_MASTER", label: "GAME MASTER", icon: Gamepad2,  color: "text-violet-400",  desc: "Gemini 2.5 · Narrative arcs & consequence engine" },
  { id: "WEBMASTER",  label: "WEBMASTER",  icon: Globe,     color: "text-cyan-400",    desc: "Build complete client websites — AI copy, Gutenberg blocks, WordPress publishing" },
];

const QUICK_PROMPTS = [
  "What should I focus on today?",
  "Status check across all arcs",
  "Log a journal entry for this session",
];

export default function MavisChat() {
  const navigate = useNavigate();
  const _appData = useAppData() as any;
  const {
    profile, quests, tasks, skills, journalEntries, vaultEntries,
    chatMessages, setChatMessages, conversationId, setConversationId,
    chatMode, setChatMode, refetchAll,
    rituals, councils, energySystems, inventory, allies, bpmSessions, storeItems, transformations,
  } = _appData;
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<ExecutionResult[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, 1 | -1>>({});
  const [showModes, setShowModes] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [agentThinking, setAgentThinking] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [artifactLang, setArtifactLang] = useState<string>("text");
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_BY_GENDER.female);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const recognitionRef = useRef<any>(null);

  // ── Crew coordinator state ──
  const [agentPanelTab, setAgentPanelTab] = useState<"specialist" | "crew">("specialist");
  const [crewGoal, setCrewGoal] = useState("");
  const [crewRunning, setCrewRunning] = useState(false);
  const [crewResult, setCrewResult] = useState("");

  // ── Standing orders panel ──
  const [showOrdersPanel, setShowOrdersPanel] = useState(false);
  const [customOrders, setCustomOrders] = useState<string[]>([]);
  const [newOrder, setNewOrder] = useState("");

  // ── Persona injection ──
  const [selectedPersonaPrompt, setSelectedPersonaPrompt] = useState<string | null>(null);
  const [selectedPersonaName, setSelectedPersonaName] = useState<string | null>(null);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [pickerPersonas, setPickerPersonas] = useState<{ id: string; name: string; system_prompt: string }[]>([]);

  // ElevenLabs TTS + chat attachments
  const { speak, stop: stopSpeaking, isSpeaking, isLoading: isVoiceLoading } = useElevenLabsTts();
  const { attachments, isUploading, upload, remove } = useChatAttachments("mavis", "main");

  // ── Register the mavis-actions edge function as default action handler ──
  useEffect(() => {
    setDefaultHandler(async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated — please sign in again");
      const { data: actionData, error: actionError } = await supabase.functions.invoke("mavis-actions", {
        body: { actions: [payload] },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (actionError) throw actionError;
      const failed = Array.isArray(actionData?.results)
        ? actionData.results.filter((r: any) => r?.success === false)
        : [];
      if (failed.length > 0) {
        throw new Error(failed.map((r: any) => `${r.type}: ${r.error || "Unknown error"}`).join(" | "));
      }
    });

    // propose_product — queues create_product task for operator approval in Inbox
    registerActionHandler("propose_product", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      const { error } = await supabase.from("mavis_tasks").insert({
        user_id: session.user.id,
        type: "create_product",
        description: `Product proposal: "${payload.title}" — $${((Number(payload.price_cents) || 2900) / 100).toFixed(2)}`,
        payload: payload as any,
        status: "requires_confirmation",
      } as any);
      if (error) throw error;
    });

    // nora_tweet — queues a tweet for Nora Vale for operator approval
    registerActionHandler("nora_tweet", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      const { error } = await supabase.from("mavis_tasks").insert({
        user_id: session.user.id,
        type: "nora_tweet",
        description: `Nora tweet: "${String(payload.content).slice(0, 60)}…"`,
        payload: payload as any,
        status: "requires_confirmation",
      } as any);
      if (error) throw error;
    });

    // create_skill_definition — MAVIS writes a new runtime skill to the DB
    registerActionHandler("create_skill_definition", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      const { error } = await supabase.from("mavis_skill_definitions").upsert({
        user_id: session.user.id,
        name: payload.name,
        description: payload.description,
        keywords: payload.keywords,
        prompt_template: payload.prompt_template,
        is_active: true,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: "user_id,name" });
      if (error) throw error;
    });
  }, []);

  // Persist voice preference in localStorage so it survives reloads
  useEffect(() => {
    const saved = localStorage.getItem("mavis-voice-id");
    if (saved && findVoice(saved)) setVoiceId(saved);
    const savedTts = localStorage.getItem("mavis-voice-enabled");
    if (savedTts === "true") setTtsEnabled(true);
  }, []);
  useEffect(() => { localStorage.setItem("mavis-voice-id", voiceId); }, [voiceId]);
  useEffect(() => { localStorage.setItem("mavis-voice-enabled", String(ttsEnabled)); }, [ttsEnabled]);

  // ── Speech Recognition (STT) ────────────────────────────
  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";
    let interimTranscript = "";

    recognition.onresult = (event: any) => {
      interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interimTranscript = transcript;
        }
      }
      setInput(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error !== "aborted") {
        toast.error(`Voice error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // ── Text-to-Speech via ElevenLabs ───────────────────────
  const speakText = useCallback((text: string) => {
    if (!ttsEnabled || voiceOverlayOpen) return;
    const cleanText = text
      .replace(/:::ACTION\{[\s\S]*?\}:::/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`(.*?)`/g, "$1")
      .replace(/#{1,6}\s/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~`#]/g, "")
      .trim();
    if (!cleanText) return;
    const gender = findVoice(voiceId)?.gender ?? "female";
    const previousText = [...chatMessages]
      .reverse()
      .find((m: any) => m.role === "assistant")?.content;
    speak(cleanText, { voiceId, gender, previousText });
  }, [ttsEnabled, voiceOverlayOpen, voiceId, speak, chatMessages]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const scrollable = scrollHeight - clientHeight;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120);
    setScrollProgress(scrollable > 0 ? Math.round((scrollTop / scrollable) * 100) : 100);
    setShowBackToTop(scrollTop > 200);
  }, []);

  // ── Load persisted chat from DB on mount ─────────────────
  useEffect(() => {
    if (dbLoaded) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setDbLoaded(true); return; }

        // Init three-layer memory engine + load DB-backed runtime skills
        initSession(session.user.id);
        loadRuntimeSkills(session.user.id).catch(err => console.warn("[Skills] Runtime load failed:", err));

        // Load standing orders custom directives
        setCustomOrders(getCustomOrders());

        // Pre-load personas for picker
        supabase.from("personas").select("id, name, system_prompt").eq("is_active", true).eq("user_id", session.user.id)
          .then(({ data }) => { if (data) setPickerPersonas(data as any); })
          .catch(() => {});

        const { data: convos } = await supabase
          .from("chat_conversations")
          .select("id, title")
          .eq("user_id", session.user.id)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (!convos?.length) { setDbLoaded(true); return; }

        const convoId = convos[0].id;

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
          setConversationId(convoId);
        }
      } catch (err) {
        console.error("Failed to restore chat:", err);
      } finally {
        setDbLoaded(true);
      }
    })();
  }, []);

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

  const sessions = useMemo(() => groupMessagesIntoSessions(chatMessages), [chatMessages]);
  const initMessage = useMemo(() => chatMessages.find((m) => m.id === "init"), [chatMessages]);
  const lastBotMessage = useMemo(() => {
    const last = chatMessages.filter((m) => m.role === "assistant").at(-1);
    if (!last) return "";
    if (typeof last.content === "string") return last.content;
    if (Array.isArray(last.content)) return (last.content as any[]).map((c) => (typeof c === "string" ? c : c?.text ?? "")).join("").trim();
    return "";
  }, [chatMessages]);
  const nonInitCount = useMemo(() => chatMessages.filter((m) => m.id !== "init").length, [chatMessages]);
  const lastMessageTime = useMemo(() => {
    const last = [...chatMessages].reverse().find((m) => m.id !== "init");
    return last?.timestamp;
  }, [chatMessages]);

  // ── OmniSync: save full app state + condensed chat ───────
  const handleOmniSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");

      const condensedComms = chatMessages
        .filter(m => m.id !== "init")
        .map(m => `[${m.role === "user" ? "OP" : "MAVIS"}${m.mode ? `/${m.mode}` : ""}] ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`)
        .join("\n");

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

  // ── Save important memories from conversation ─────────────
  const saveMemoriesFromResponse = useCallback(async (userContent: string, assistantContent: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const meaningfulPatterns = /\b(remember|important|key point|never forget|note to self|always|my name|i am|i'm from|i live|i work|my goal|my dream|my fear|decided|committed|promise|plan is|strategy is)\b/i;
      const isUserMeaningful = meaningfulPatterns.test(userContent) || userContent.length > 200;

      if (isUserMeaningful) {
        await supabase.from("memories").insert({
          user_id: session.user.id,
          title: `Key Info — ${new Date().toLocaleDateString()}`,
          content: `USER: ${userContent}\n\nMAVIS: ${assistantContent.slice(0, 2000)}`,
          memory_type: "key_information",
          source: "mavis_auto_memory",
          tags: ["auto_extracted", "key_info"],
          metadata: { extracted_at: new Date().toISOString() },
        });
      }
    } catch {} // Non-critical
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    cancelledRef.current = false;
    setInput("");
    setActionStatus(null);

    const abortController = new AbortController();
    abortRef.current = abortController;

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

    if (convoId) {
      persistMessage({ role: "user", content, mode: chatMode }, convoId).catch(() => {});
    }

    const history = chatMessages
      .filter((m) => m.id !== "init")
      .slice(-18)
      .map((m) => ({ role: m.role, content: m.content }));

    // Load full app context fresh from Supabase — ensures AI always sees latest data
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const userId = authSession?.user?.id;

    // Load archived memories and vault media in parallel with full app context
    const [fullCtx, memoriesRes, vaultMediaRes, , recallCtxRaw] = await Promise.all([
      userId ? loadFullAppContext(userId) : Promise.resolve(null),
      (async () => {
        if (!userId) return "";
        try {
          const { data: memories } = await supabase
            .from("memories")
            .select("title, content, metadata, created_at")
            .eq("user_id", userId)
            .or("source.eq.mavis_chat_clear,source.eq.mavis_auto_memory,source.eq.council_chat_clear")
            .order("created_at", { ascending: false })
            .limit(5);
          return (memories ?? []).map((m: any) =>
            `[${m.title}]\n${(m.metadata as any)?.topic_summary || m.content.slice(0, 1000)}`
          ).join("\n---\n");
        } catch { return ""; }
      })(),
      (async () => {
        if (!userId) return [];
        try {
          const { data } = await supabase
            .from("vault_media")
            .select("id, file_name, file_type, file_size, file_url, description, tags, vault_entry_id")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(50);
          return data ?? [];
        } catch { return []; }
      })(),
      // pre-warm provider cache so buildSystemPromptFromSnapshot gets instant results
      userId ? gatherProviderContext(userId, content).catch(() => "") : Promise.resolve(""),
      // proactive recall runs in parallel too
      userId ? buildRecallContext(userId, content, 3).catch(() => null) : Promise.resolve(null),
    ]);

    const archivedMemories = memoriesRes as string;
    const vaultMedia = vaultMediaRes as any[];

    // Build compact ID→name map for edge function action inference
    const compactState = [
      ...(quests || []).map((q: any) => `QUEST [${q.id}] "${q.title}" status:${q.status}`),
      ...(tasks || []).map((t: any) => `TASK [${t.id}] "${t.title}" status:${t.status}`),
      ...(skills || []).map((s: any) => `SKILL [${s.id}] "${s.name}"${s.parent_skill_id ? ` parent:${s.parent_skill_id}` : ""}`),
      ...(journalEntries || []).map((j: any) => `JOURNAL [${j.id}] "${j.title}"`),
      ...(vaultEntries || []).map((v: any) => `VAULT [${v.id}] "${v.title}"`),
      ...(councils || []).map((c: any) => `COUNCIL [${c.id}] "${c.name}"`),
      ...(allies || []).map((a: any) => `ALLY [${a.id}] "${a.name}"`),
      ...(inventory || []).map((i: any) => `INVENTORY [${i.id}] "${i.name}"`),
      ...(transformations || []).map((t: any) => `TRANSFORMATION [${t.id}] "${t.name}"`),
      ...(storeItems || []).map((s: any) => `STORE [${s.id}] "${s.name}"`),
    ].join("\n");

    let streamingId = "";
    try {
      // Use fresh Supabase context if available, else fall back to useAppData() data
      let systemPrompt = await (fullCtx
        ? buildSystemPromptFromSnapshot(chatMode, fullCtx, archivedMemories, vaultMedia)
        : buildSystemPromptFromSnapshot(chatMode, ({
            profile: profile as any,
            quests: quests as any[], tasks: tasks as any[], skills: skills as any[],
            rankings: [], transformations: transformations as any[],
            journalEntries: journalEntries as any[], vaultEntries: vaultEntries as any[],
            councilMembers: councils as any[], inventory: inventory as any[],
            storeItems: storeItems as any[], energySystems: energySystems as any[],
            bpmSessions: bpmSessions as any[], allies: allies as any[],
            rituals: rituals as any[], pendingApprovals: [], loadedAt: new Date().toISOString(),
          } as any), archivedMemories, vaultMedia));
      if (recallCtxRaw) systemPrompt += `\n\n${recallCtxRaw}`;
      if (selectedPersonaPrompt) systemPrompt += `\n\n--- ACTIVE PERSONA ---\n${selectedPersonaPrompt}\n---`;
      const attachmentIds = attachments.map((a) => a.id);

      // Add a streaming placeholder bubble so the user sees tokens as they arrive
      streamingId = `streaming-${Date.now()}`;
      setChatMessages((prev) => [...prev, {
        id: streamingId,
        role: "assistant" as const,
        content: "",
        mode: chatMode,
        timestamp: new Date(),
      }]);

      const onToken = (_token: string, accumulated: string) => {
        if (cancelledRef.current) return;
        if (agentThinking !== null) setAgentThinking(null);
        setChatMessages((prev) => prev.map((m) =>
          m.id === streamingId ? { ...m, content: accumulated } : m
        ));
      };

      const { cleanText, executionResults, conversationId: newConvoId, searched, imageUrl, fnData } =
        chatMode === "AGENT"
          ? await streamAgentMessage(
              content,
              systemPrompt,
              history,
              { mode: chatMode, conversationId, appState: compactState, chatKind: "mavis", threadRef: "main", attachmentIds },
              onToken,
              (toolInfo) => { if (!cancelledRef.current) setAgentThinking(toolInfo); },
              abortController.signal,
            )
          : chatMode === "RESEARCH"
          ? await streamResearchMessage(
              content,
              { mode: chatMode, conversationId, appState: compactState, chatKind: "mavis", threadRef: "main", attachmentIds },
              onToken,
              abortController.signal,
            )
          : await streamChatMessage(
              content,
              systemPrompt,
              history,
              { mode: chatMode, conversationId, appState: compactState, chatKind: "mavis", threadRef: "main", attachmentIds },
              onToken,
              abortController.signal,
            );

      if (cancelledRef.current) {
        setChatMessages((prev) => prev.filter((m) => m.id !== streamingId));
        setAgentThinking(null);
        return;
      }

      // Separate confirmed vs pending actions
      const confirmed = executionResults.filter((r) => r.status === "success");
      const pending = executionResults.filter((r) => r.status === "pending_confirmation");
      const failed = executionResults.filter((r) => r.status === "error");

      if (pending.length > 0) {
        setPendingActions((prev) => [...prev, ...pending]);
      }

      if (confirmed.length > 0 || failed.length > 0) {
        // Trigger data refresh after successful action writes
        if (confirmed.length > 0) {
          await new Promise(r => setTimeout(r, 500));
          await refetchAll();
          setTimeout(() => { refetchAll(); }, 1500);
          // Hermes procedural memory: capture how this request was handled
          if (userId) captureProceduralMemory(userId, content, confirmed).catch(() => {});
        }
        const actionTypes = confirmed.map((r) => r.action.type).join(", ");
        if (failed.length > 0) {
          setActionStatus(`⚠ ${failed.length} action${failed.length > 1 ? "s" : ""} failed`);
        } else {
          setActionStatus(`✓ ${actionTypes}`);
        }
        setTimeout(() => setActionStatus(null), 3000);
      } else if (executionResults.length > 0 && pending.length === executionResults.length) {
        setActionStatus(`⏳ ${pending.length} action${pending.length > 1 ? "s" : ""} pending confirmation`);
        setTimeout(() => setActionStatus(null), 4000);
      }

      const actionsExecuted = confirmed.length;
      const agentSources: Array<{ title: string; url: string }> = (fnData as any)?.sources ?? [];
      const agentIterations: number | null = (fnData as any)?.iterations ?? null;
      const imageMediaId: string | null = (fnData as any)?.imageMediaId ?? null;

      // Auto-link generated image to vault entry if both were created this turn
      if (imageMediaId && confirmed.some(r => ["create_vault", "create_vault_entry", "add_vault"].includes(r.action.type))) {
        (async () => {
          try {
            const { data: { session: s2 } } = await supabase.auth.getSession();
            if (!s2?.user) return;
            const fiveSecsAgo = new Date(Date.now() - 5000).toISOString();
            const { data: recent } = await supabase.from("vault_entries").select("id").eq("user_id", s2.user.id).gte("created_at", fiveSecsAgo).order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (recent?.id) await supabase.from("vault_media").update({ vault_entry_id: recent.id }).eq("id", imageMediaId);
          } catch { /* non-critical */ }
        })();
      }
      const assistantMsg = {
        id: `a-${Date.now()}`,
        role: "assistant" as const,
        content: cleanText,
        mode: chatMode,
        model: (fnData as any)?.model ?? null,
        searched: searched || agentSources.length > 0,
        actionsExecuted,
        imageUrl: imageUrl ?? undefined,
        sources: agentSources,
        iterations: agentIterations,
        timestamp: new Date(),
      };
      // Replace streaming placeholder with the final fully-processed message
      setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat(assistantMsg));
      speakText(cleanText);
      if (newConvoId) setConversationId(newConvoId);

      if (convoId) {
        await persistMessage({ role: "assistant", content: cleanText, mode: chatMode }, convoId);
      }
      saveMemoriesFromResponse(content, cleanText);
    } catch (err: any) {
      if (cancelledRef.current || err?.name === "AbortError") {
        if (streamingId) setChatMessages((prev) => prev.filter((m) => m.id !== streamingId));
        return;
      }
      if (streamingId) setChatMessages((prev) => prev.filter((m) => m.id !== streamingId));
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
      setAgentThinking(null);
      abortRef.current = null;
    }
  }, [input, chatMessages, isLoading, chatMode, agentThinking, profile, quests, tasks, skills, journalEntries, vaultEntries, conversationId, setChatMessages, setConversationId, refetchAll, ensureConversation, persistMessage, saveMemoriesFromResponse, speakText, attachments]);

  const sendFeedback = useCallback(async (msg: any, rating: 1 | -1) => {
    if (feedbackGiven[msg.id]) return;
    setFeedbackGiven((prev) => ({ ...prev, [msg.id]: rating }));
    try {
      await supabase.from("mavis_response_feedback").insert({
        user_id: profile?.id,
        message_id: msg.id,
        conversation_id: conversationId ?? null,
        rating,
        provider: msg.model ?? null,
        mode: msg.mode ?? null,
        response_preview: (msg.content ?? "").slice(0, 200),
      });
    } catch { /* non-critical */ }
  }, [feedbackGiven, profile, conversationId]);

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = useCallback(async () => {
    await handleOmniSync();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && chatMessages.length > 1) {
        const memoryContent = chatMessages
          .filter(m => m.id !== "init")
          .map(m => `[${m.role === "user" ? "OPERATOR" : "MAVIS"}] ${m.content}`)
          .join("\n\n");

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

        if (conversationId) {
          await supabase.from("chat_messages").delete().eq("conversation_id", conversationId).eq("user_id", session.user.id);
          await supabase.from("chat_conversations").delete().eq("id", conversationId).eq("user_id", session.user.id);
        }
      }
    } catch (err) {
      console.error("Memory save on clear failed:", err);
    }

    setChatMessages([{
      id: "init",
      role: "assistant",
      content: "Thread archived to memory. I remember everything. What's next?",
      mode: "PRIME",
      timestamp: new Date(),
    }]);
    setConversationId(null);
    setPendingActions([]);
    toast.success("Thread archived — memories preserved");
  }, [handleOmniSync, chatMessages, chatMode, conversationId, setChatMessages, setConversationId]);

  return (
    <>
    <div className="flex gap-3 h-[calc(100dvh-4rem)]">
    <div className="flex flex-col flex-1 min-w-0 gap-2 pb-0">
      <PageHeader
        title="MAVIS"
        subtitle={`Mode: ${currentMode.label} // Supreme Intelligence`}
        icon={<Cpu size={18} />}
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/council-board")}
              className="flex items-center gap-1.5 text-xs font-mono text-amber-400 hover:text-amber-300 border border-amber-900/40 hover:border-amber-400/40 rounded px-2 py-1 transition-all"
              title="Open Council Board"
            >
              <Users size={12} />
              Council
            </button>
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

      {/* Pending confirmations banner */}
      <AnimatePresence>
        {pendingActions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center justify-between gap-2 px-3 py-1.5 rounded border border-amber-500/30 bg-amber-500/5 text-xs font-mono text-amber-400"
          >
            <span>⚠ {pendingActions.length} action{pendingActions.length > 1 ? "s" : ""} require confirmation</span>
            <button
              onClick={() => setPendingActions([])}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Standing Orders Panel */}
      <AnimatePresence>
        {showOrdersPanel && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="border border-primary/30 rounded-lg bg-primary/5 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-primary uppercase tracking-widest">Standing Orders — Custom Directives</span>
              <button onClick={() => setShowOrdersPanel(false)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </div>
            {customOrders.length === 0 ? (
              <p className="text-[9px] font-mono text-muted-foreground">No custom directives. Core standing orders are always active.</p>
            ) : (
              <div className="space-y-1">
                {customOrders.map((o) => (
                  <div key={o} className="flex items-center gap-2">
                    <span className="text-[9px] font-mono flex-1 text-foreground/80">• {o}</span>
                    <button onClick={() => { removeStandingOrder(o); setCustomOrders(getCustomOrders()); }} className="text-muted-foreground hover:text-destructive"><X size={10} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={newOrder} onChange={(e) => setNewOrder(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newOrder.trim()) { addStandingOrder(newOrder.trim()); setCustomOrders(getCustomOrders()); setNewOrder(""); } }}
                placeholder="Add directive..." className="flex-1 bg-card border border-border rounded px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground" />
              <button onClick={() => { if (newOrder.trim()) { addStandingOrder(newOrder.trim()); setCustomOrders(getCustomOrders()); setNewOrder(""); } }}
                className="px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary text-[9px] font-mono hover:bg-primary/20">Add</button>
            </div>
            <p className="text-[8px] font-mono text-muted-foreground">Core directives are always active. These are your custom additions.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persona picker panel */}
      <AnimatePresence>
        {showPersonaPicker && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="border border-border rounded-lg bg-card p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-primary uppercase tracking-widest">Inject Persona Context</span>
              <button onClick={() => setShowPersonaPicker(false)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </div>
            {pickerPersonas.length === 0 ? (
              <p className="text-[9px] font-mono text-muted-foreground">No personas found. Create one on the Personas page.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {pickerPersonas.map((p) => (
                  <button key={p.id}
                    onClick={() => { setSelectedPersonaPrompt(p.system_prompt); setSelectedPersonaName(p.name); setShowPersonaPicker(false); }}
                    className={`text-[9px] font-mono px-2 py-1 rounded border transition-colors ${selectedPersonaName === p.name ? "bg-primary/20 border-primary/40 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground"}`}
                  >{p.name}</button>
                ))}
                {selectedPersonaName && (
                  <button onClick={() => { setSelectedPersonaPrompt(null); setSelectedPersonaName(null); }}
                    className="text-[9px] font-mono px-2 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10">Clear</button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mode selector */}
      <div className="flex items-center gap-2">
      <div className="relative flex-1">
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
      <div className="flex items-center gap-1 shrink-0">
        {selectedPersonaName && (
          <span className="text-[9px] font-mono px-2 py-1 rounded bg-primary/10 border border-primary/30 text-primary">{selectedPersonaName}</span>
        )}
        <button onClick={() => setShowPersonaPicker((v) => !v)} title="Inject persona context"
          className="p-2 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors text-[10px] font-mono">
          <Users size={12} />
        </button>
        <button onClick={() => setShowOrdersPanel((v) => !v)} title="Standing orders"
          className="p-2 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors">
          <Database size={12} />
        </button>
        <button onClick={() => setVoiceOverlayOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 text-primary/70 hover:text-primary hover:bg-primary/10 text-xs font-mono transition-all">
          <Mic size={12} /> VOICE
        </button>
      </div>
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <ScrollProgressBar progress={scrollProgress} />
        <BackToTopButton visible={showBackToTop} onClick={scrollToTop} />
        <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto space-y-3 pr-1 pt-0.5 scrollbar-thin">
          {/* Init message rendered outside session blocks */}
          {initMessage && (
            <motion.div
              key={initMessage.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <div className="w-7 h-7 rounded shrink-0 flex items-center justify-center text-xs font-display font-bold border bg-primary/10 border-primary/30 text-primary">M</div>
              <div className="relative group max-w-[82%] rounded-lg px-3 py-2.5 hud-border text-foreground">
                <div className="prose prose-sm prose-invert max-w-none text-xs font-body leading-relaxed">
                  <ReactMarkdown>{initMessage.content}</ReactMarkdown>
                </div>
                <span className="text-[8px] font-mono text-muted-foreground/50">
                  {initMessage.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </motion.div>
          )}

          {/* Session blocks — one per consecutive mode run */}
          {sessions.map((session, idx) => {
            const isLive = idx === sessions.length - 1;
            return (
              <SessionBlock
                key={session.id}
                session={session}
                isLive={isLive}
                hasVoice={ttsEnabled}
                defaultExpanded={isLive}
              >
                {session.messages.map((msg: any) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                  >
                    <div className={`w-7 h-7 rounded shrink-0 flex items-center justify-center text-xs font-display font-bold border ${
                      msg.role === "assistant"
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-muted/50 border-border text-muted-foreground"
                    }`}>
                      {msg.role === "assistant" ? "M" : "V"}
                    </div>
                    <div className={`relative group max-w-[82%] rounded-lg px-3 py-2.5 ${
                      msg.role === "user"
                        ? "bg-primary/10 border border-primary/20 text-foreground"
                        : "hud-border text-foreground"
                    }`}>
                      {msg.role === "assistant" ? (
                        <>
                          {msg.id.startsWith("streaming-") && msg.content === "" ? (
                            <div className="flex flex-col gap-1.5 py-1 px-0.5">
                              <div className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "160ms" }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "320ms" }} />
                              </div>
                              {agentThinking && (
                                <span className="text-[9px] font-mono text-violet-400/80 truncate max-w-[260px]">
                                  ⚙ {agentThinking}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="mavis-prose">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          )}
                          {(() => {
                            const codeMatch = msg.content.match(/```(\w*)\n([\s\S]{200,}?)```/);
                            if (!codeMatch) return null;
                            const [, lang, code] = codeMatch;
                            return (
                              <button
                                onClick={() => { setArtifactContent(code.trim()); setArtifactLang(lang || "text"); }}
                                className="mt-2 flex items-center gap-1.5 text-[9px] font-mono text-cyan-400 border border-cyan-900/40 rounded px-2 py-1 hover:bg-cyan-900/20 transition-colors"
                              >
                                <FileCode size={10} /> Open Artifact
                              </button>
                            );
                          })()}
                          {(msg as any).imageUrl && (
                            <div className="mt-2">
                              <img
                                src={(msg as any).imageUrl}
                                alt="MAVIS generated image"
                                className="rounded-lg max-w-full border border-primary/20"
                                style={{ maxHeight: "420px", objectFit: "contain" }}
                              />
                            </div>
                          )}
                          {(msg as any).sources?.length > 0 && (
                            <div className="mt-2 flex flex-col gap-0.5">
                              {(msg as any).sources.map((s: { title: string; url: string }, i: number) => (
                                <a
                                  key={i}
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[8px] font-mono text-cyan-400/80 hover:text-cyan-300 underline underline-offset-2 truncate block max-w-[280px]"
                                >
                                  [{i + 1}] {s.title}
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-xs font-body leading-relaxed">{msg.content}</p>
                      )}
                      <div className="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
                        {(msg as any).searched && (
                          <span className="text-[8px] font-mono text-cyan-400 border border-cyan-900/40 rounded px-1.5 py-0.5">
                            🔍 web search
                          </span>
                        )}
                        {(msg as any).iterations != null && (
                          <span className="text-[8px] font-mono text-violet-400 border border-violet-900/40 rounded px-1.5 py-0.5">
                            ⚙ {(msg as any).iterations} step{(msg as any).iterations !== 1 ? "s" : ""}
                          </span>
                        )}
                        {(msg as any).actionsExecuted > 0 && (
                          <span className="text-[8px] font-mono text-primary border border-primary/30 rounded px-1.5 py-0.5">
                            ⚡ {(msg as any).actionsExecuted} action{(msg as any).actionsExecuted > 1 ? "s" : ""} executed
                          </span>
                        )}
                        {msg.mode && msg.role === "assistant" && !(msg as any).searched && !(msg as any).actionsExecuted && (msg as any).iterations == null && (
                          <span className="text-[8px] font-mono text-muted-foreground/60">[{msg.mode}]{(msg as any).model ? ` · ${(msg as any).model}` : ""}</span>
                        )}
                        <span className="text-[8px] font-mono text-muted-foreground/50 ml-auto">
                          {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <button
                        onClick={() => copyMessage(msg.id, msg.content)}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                      >
                        {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                      </button>
                      {msg.role === "assistant" && !msg.id.startsWith("streaming-") && msg.content && (
                        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          <button
                            onClick={() => sendFeedback(msg, 1)}
                            title="Good response"
                            className={`p-0.5 rounded transition-colors ${feedbackGiven[msg.id] === 1 ? "text-emerald-400" : "text-muted-foreground/50 hover:text-emerald-400"}`}
                          >
                            <ThumbsUp size={9} />
                          </button>
                          <button
                            onClick={() => sendFeedback(msg, -1)}
                            title="Bad response"
                            className={`p-0.5 rounded transition-colors ${feedbackGiven[msg.id] === -1 ? "text-red-400" : "text-muted-foreground/50 hover:text-red-400"}`}
                          >
                            <ThumbsDown size={9} />
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </SessionBlock>
            );
          })}

          {!isLoading && nonInitCount > 0 && (
            <EndOfFeed messageCount={nonInitCount} lastUpdated={lastMessageTime} />
          )}

          {isLoading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded bg-primary/10 border border-primary/30 flex items-center justify-center text-xs font-display text-primary">M</div>
              <div className="hud-border rounded-lg px-3 py-2.5">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <ScrollToBottomButton visible={showScrollBtn} onClick={scrollToBottom} />
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

      {/* AGENT mode panel — specialist + crew tabs */}
      <AnimatePresence>
        {chatMode === "AGENT" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="border border-violet-800/40 rounded-lg bg-violet-950/20 p-3 space-y-2"
          >
            {/* Tab toggle */}
            <div className="flex items-center gap-2">
              <Cpu size={11} className="text-violet-400" />
              {(["specialist", "crew"] as const).map((tab) => (
                <button key={tab} onClick={() => setAgentPanelTab(tab)}
                  className={`text-[9px] font-mono px-2 py-0.5 rounded border transition-colors ${agentPanelTab === tab ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "border-border/40 text-muted-foreground hover:text-foreground"}`}
                >{tab.toUpperCase()}</button>
              ))}
            </div>

            {agentPanelTab === "specialist" ? (
              <>
                <div className="flex gap-2 flex-wrap">
                  {(["researcher", "analyst", "executor", "planner", "writer"] as const).map((s) => (
                    <button key={s} onClick={() => {}}
                      className="text-[9px] font-mono px-2 py-1 rounded border border-border/50 text-muted-foreground hover:text-foreground transition-colors">{s}</button>
                  ))}
                </div>
                <p className="text-[9px] font-mono text-muted-foreground">Type your task in the input above and send — AGENT mode routes to the specialist automatically.</p>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <input value={crewGoal} onChange={(e) => setCrewGoal(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && crewGoal.trim() && !crewRunning) {
                        setCrewRunning(true); setCrewResult("");
                        const { data: { session: s } } = await supabase.auth.getSession();
                        if (!s?.user) { setCrewRunning(false); return; }
                        const res = await autoCrewDispatch(crewGoal.trim(), s.user.id).catch((err) => ({ output: `Error: ${err.message}`, agentResults: [] }));
                        setCrewResult((res as any).output);
                        setChatMessages((prev) => [...prev, { id: `crew-${Date.now()}`, role: "assistant" as const, content: `**[CREW COMPLETE]**\n\n${(res as any).output}`, mode: "AGENT", timestamp: new Date() }]);
                        setCrewRunning(false);
                      }
                    }}
                    placeholder="Describe a goal for the researcher + analyst + planner crew..."
                    className="flex-1 bg-card border border-border rounded px-2.5 py-1.5 text-xs font-body focus:outline-none focus:border-violet-500/50 placeholder:text-muted-foreground placeholder:text-[10px]"
                  />
                  <button onClick={async () => {
                    if (!crewGoal.trim() || crewRunning) return;
                    setCrewRunning(true); setCrewResult("");
                    const { data: { session: s } } = await supabase.auth.getSession();
                    if (!s?.user) { setCrewRunning(false); return; }
                    const res = await autoCrewDispatch(crewGoal.trim(), s.user.id).catch((err) => ({ output: `Error: ${err.message}`, agentResults: [] }));
                    setCrewResult((res as any).output);
                    setChatMessages((prev) => [...prev, { id: `crew-${Date.now()}`, role: "assistant" as const, content: `**[CREW COMPLETE]**\n\n${(res as any).output}`, mode: "AGENT", timestamp: new Date() }]);
                    setCrewRunning(false);
                  }} disabled={crewRunning || !crewGoal.trim()}
                    className="px-3 py-1.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300 text-[10px] font-mono hover:bg-violet-500/20 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                  >
                    {crewRunning ? <><span className="w-2 h-2 rounded-full border border-violet-400 border-t-transparent animate-spin" /> Running</> : <><Cpu size={10} /> Launch Crew</>}
                  </button>
                </div>
                {crewResult && (
                  <div className="border border-border/50 rounded bg-muted/20 p-2 max-h-28 overflow-y-auto">
                    <pre className="text-[10px] font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{crewResult}</pre>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice controls */}
      <div className="flex items-center gap-2 justify-end flex-wrap">
        <VoicePicker
          enabled={ttsEnabled}
          onToggle={() => {
            if (ttsEnabled && isSpeaking) stopSpeaking();
            setTtsEnabled(!ttsEnabled);
          }}
          voiceId={voiceId}
          onVoiceChange={setVoiceId}
          isSpeaking={isSpeaking}
          isLoading={isVoiceLoading}
          onStop={stopSpeaking}
        />
      </div>

      {/* Attachment tray (only when files present) */}
      {(attachments.length > 0 || isUploading) && (
        <div className="px-1">
          <AttachmentTray
            attachments={attachments}
            isUploading={isUploading}
            onUpload={upload}
            onRemove={remove}
            compact
          />
        </div>
      )}

      {/* Input — pinned to bottom with safe-area padding for mobile */}
      <div className="flex gap-2 mt-auto pt-1 pb-[max(env(safe-area-inset-bottom),0.25rem)]">
        <AttachButton
          isUploading={isUploading}
          onUpload={upload}
          className="px-3 py-2 rounded-lg border bg-muted/30 border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-all self-end disabled:opacity-40"
        />
        {/* Mic button */}
        <button
          onClick={() => {
            if (isListening) {
              stopListening();
            } else {
              startListening();
            }
          }}
          className={`px-3 py-2 rounded-lg border transition-all self-end ${
            isListening
              ? "bg-destructive/10 border-destructive/30 text-destructive animate-pulse"
              : "bg-muted/30 border-border text-muted-foreground hover:text-primary hover:border-primary/30"
          }`}
          title={isListening ? "Stop listening" : "Start voice input"}
        >
          {isListening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isComposing) {
              e.preventDefault();
              if (isListening) stopListening();
              sendMessage();
            }
          }}
          placeholder={isListening ? "Listening... speak now" : `MAVIS-${currentMode.label} awaiting input...`}
          rows={2}
          className={`flex-1 bg-card border rounded-lg px-3 py-2.5 text-sm font-body resize-none focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground placeholder:font-mono placeholder:text-xs ${
            isListening ? "border-destructive/40" : "border-border"
          }`}
        />
        {isLoading ? (
          <button
            onClick={() => {
              cancelledRef.current = true;
              abortRef.current?.abort();
              stopSpeaking();
              setIsLoading(false);
            }}
            className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-all self-end"
            title="Stop generating"
          >
            <Square size={18} />
          </button>
        ) : (
          <button
            onClick={() => {
              if (isListening) stopListening();
              sendMessage();
            }}
            disabled={!input.trim()}
            className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all self-end"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>

    {/* Artifact pane — slides in when content is selected */}
    <AnimatePresence>
      {artifactContent && (
        <motion.div
          initial={{ opacity: 0, x: 24, width: 0 }}
          animate={{ opacity: 1, x: 0, width: 360 }}
          exit={{ opacity: 0, x: 24, width: 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 flex flex-col border border-border rounded-lg bg-card overflow-hidden"
          style={{ maxHeight: "calc(100dvh - 4rem)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <FileCode size={13} className="text-primary" />
              <span className="text-[10px] font-mono text-primary uppercase tracking-widest">Artifact</span>
              {artifactLang !== "text" && (
                <span className="text-[9px] font-mono text-muted-foreground bg-muted/50 px-1.5 rounded">{artifactLang}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { navigator.clipboard.writeText(artifactContent); toast.success("Copied"); }}
                className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
                title="Copy"
              >
                <Copy size={12} />
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([artifactContent], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url;
                  a.download = `mavis-artifact.${artifactLang === "text" ? "txt" : artifactLang}`;
                  a.click(); URL.revokeObjectURL(url);
                }}
                className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
                title="Download"
              >
                <Download size={12} />
              </button>
              <button
                onClick={() => setArtifactContent(null)}
                className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                title="Close"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3">
            <pre className="text-[10px] font-mono text-foreground/90 whitespace-pre-wrap leading-relaxed break-words">
              {artifactContent}
            </pre>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>

    <AnimatePresence>
      {voiceOverlayOpen && (
        <VoiceChatOverlay
          onClose={() => setVoiceOverlayOpen(false)}
          sendMessage={async (text) => { setInput(text); await sendMessage(text); }}
          lastBotMessage={lastBotMessage}
          isLoading={isLoading}
          externalAudio={ttsEnabled}
        />
      )}
    </AnimatePresence>
    </>
  );
}
