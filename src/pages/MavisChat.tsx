import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Cpu, Copy, Check, ChevronDown, Zap, Brain, Target, Crown, Flame, Database, Mic, MicOff, Users, Search, FileCode, X, Download, Gamepad2, Layers, Globe, ThumbsUp, ThumbsDown, AlertTriangle, RefreshCw, Pencil, BookOpen, Plus } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { PageHeader, HudCard } from "@/components/SharedUI";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { useElevenLabsTts } from "@/hooks/useElevenLabsTts";
import { useChatAttachments } from "@/hooks/useChatAttachments";
import { VoicePicker } from "@/components/chat/VoicePicker";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { AttachmentTray, AttachButton } from "@/components/chat/AttachmentTray";
import { ChatMediaPreview } from "@/components/chat/ChatMediaPreview";
import { DEFAULT_VOICE_BY_GENDER, findVoice } from "@/lib/voiceCatalog";
import { ScrollProgressBar, BackToTopButton, ScrollToBottomButton, EndOfFeed } from "@/components/chat/ScrollKit";
import { SessionBlock, groupMessagesIntoSessions } from "@/components/chat/SessionBlock";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";
import { MavisRealtimeVoice } from "@/components/MavisRealtimeVoice";
import { InlineMediaPlayer } from "@/components/chat/InlineMediaPlayer";
import { SkillCatalogDrawer } from "@/components/chat/SkillCatalogDrawer";
import { useMediaPoller } from "@/hooks/useMediaPoller";

// ── MAVIS modules ───────────────────────────────────────────
import { buildSystemPromptFromSnapshot } from "@/mavis/buildSystemPrompt";
import { setDefaultHandler, registerActionHandler } from "@/mavis/actionExecutor";
import { streamChatMessage, streamAgentMessage, streamResearchMessage, invokeAI } from "@/mavis/chatService";
import { loadFullAppContext } from "@/mavis/appContextLoader";
import { initSession } from "@/mavis/memoryEngine";
import { loadRuntimeSkills } from "@/mavis/skills/_registry";
import { gatherProviderContext } from "@/mavis/contextProviders";
import { buildRecallContext } from "@/mavis/proactiveRecall";
import { captureProceduralMemory } from "@/mavis/proceduralMemory";
import { autoCrewDispatch } from "@/mavis/crewCoordinator";
import { dispatchToSpecialist } from "@/mavis/specialistDispatcher";
import { getCustomOrders, addStandingOrder, removeStandingOrder } from "@/mavis/standingOrders";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ExecutionResult, ParsedAction } from "@/mavis/types";
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
  { id: "FLOW",       label: "FLOW",       icon: Layers,    color: "text-indigo-300",   desc: "Flowise · Visual agent chains, RAG pipelines & custom LLM flows" },
  { id: "AUTO",       label: "AUTO",       icon: Cpu,       color: "text-emerald-300",  desc: "Auto-routing · MAVIS selects the optimal mode based on your message" },
];

const QUICK_PROMPTS = [
  "What should I focus on today?",
  "Status check across all arcs",
  "Log a journal entry for this session",
];

// Skill suggestions per mode — shown as one-click chips below quick prompts
const MODE_SKILL_SUGGESTIONS: Record<string, string[]> = {
  PRIME:      ["daily brief", "energy check", "goal review"],
  ARCH:       ["comprehensive review", "knowledge extract", "doc gen"],
  QUEST:      ["quest review", "habit check", "weekly retro"],
  FORGE:      ["health protocol", "energy check", "habit check"],
  CODEX:      ["knowledge extract", "doc gen", "pdf qa"],
  SOVEREIGN:  ["opportunity scan", "revenue report", "competitor analysis"],
  ENRYU:      ["daily brief", "goal review", "reflection prompt"],
  WATCHTOWER: ["news brief", "market research", "crypto intel"],
  AGENT:      ["company research", "web scrape", "youtube intel"],
  RESEARCH:   ["market research", "news brief", "influencer research"],
  REFLECT:    ["comprehensive review", "weekly retro", "reflection prompt"],
  SALES:      ["lead gen", "outreach prep", "proposal gen"],
  MARKET:     ["social content", "poster gen", "content brief"],
  DATA:       ["data analysis", "revenue report", "finance brief"],
  DEEP:       ["competitive intelligence", "market research", "data analysis"],
  GAME_MASTER:["reflection prompt", "knowledge extract", "debate"],
  WEBMASTER:  ["doc gen", "image gen", "content brief"],
  FLOW:       ["doc gen", "data analysis", "enterprise search"],
  AUTO:       ["daily brief", "image gen", "social content"],
};

const AGENCY_BASE = "https://raw.githubusercontent.com/KaiyzerCal/agency-agents/main";
const QUICK_SPECIALISTS = [
  { label: "researcher", agentId: "specialized/business-strategist.md",                        name: "Business Strategist", division: "specialized" },
  { label: "analyst",    agentId: "finance/finance-financial-analyst.md",                      name: "Financial Analyst",   division: "finance" },
  { label: "executor",   agentId: "specialized/specialized-chief-of-staff.md",                 name: "Chief of Staff",      division: "specialized" },
  { label: "planner",    agentId: "project-management/project-management-project-shepherd.md", name: "Project Shepherd",    division: "project-management" },
  { label: "writer",     agentId: "marketing/marketing-content-creator.md",                   name: "Content Creator",     division: "marketing" },
] as const;

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
  const [realtimeVoiceOpen, setRealtimeVoiceOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [agentThinking, setAgentThinking] = useState<string | null>(null);
  const [agentSteps, setAgentSteps] = useState<Array<{step: string; type?: string; ok?: boolean; count?: number; iteration?: number; preview?: string; label?: string}>>([]);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [artifactLang, setArtifactLang] = useState<string>("text");
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_BY_GENDER.female);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  // Tracks content written by the web chat so Realtime events for those
  // messages can be skipped — prevents duplicates when we receive our own writes.
  const recentWebWrites = useRef<Map<string, number>>(new Map());
  // Tracks whether the current agentModeOn=true was set by auto-detection (not the user).
  // If true, MAVIS is free to auto-deactivate when a conversational message follows.
  const agentAutoActivated = useRef(false);

  // ── SuperContext scout (OpenHuman pattern) ──
  // Assembled at session start; injected as standing context in system prompt
  const [superContext, setSuperContext] = useState<string | null>(null);
  const superContextLoaded = useRef(false);

  // ── Active Agency Specialist ──
  const [activeSpecialist, setActiveSpecialist] = useState<{
    agent_id: string; agent_name: string; division: string; spec_content: string;
  } | null>(null);

  // ── Agent Mode (Action Queue integration) ──
  const [agentModeOn, setAgentModeOn] = useState(true);
  const [lastAgentMeta, setLastAgentMeta] = useState<{ toolsUsed: string[]; actionsQueued: number } | null>(null);

  // ── Crew coordinator state ──
  const [agentPanelTab, setAgentPanelTab] = useState<"specialist" | "crew" | "delegate">("specialist");
  const [crewGoal, setCrewGoal] = useState("");
  const [crewRunning, setCrewRunning] = useState(false);
  const [crewResult, setCrewResult] = useState("");

  // ── Delegate (goal-loop) state ──
  const [delegateGoal, setDelegateGoal] = useState("");
  const [delegateRunning, setDelegateRunning] = useState(false);
  const [delegateSteps, setDelegateSteps] = useState<Array<{ iteration: number; thought: string; action: string; result: string; done: boolean }>>([]);
  const [delegateResult, setDelegateResult] = useState("");

  // ── Standing orders panel ──
  const [showOrdersPanel, setShowOrdersPanel] = useState(false);
  const [customOrders, setCustomOrders] = useState<string[]>([]);
  const [newOrder, setNewOrder] = useState("");
  const [confirmRemoveOrder, setConfirmRemoveOrder] = useState<string | null>(null);

  // ── Persona injection ──
  const [selectedPersonaPrompt, setSelectedPersonaPrompt] = useState<string | null>(null);
  const [selectedPersonaName, setSelectedPersonaName] = useState<string | null>(null);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [pickerPersonas, setPickerPersonas] = useState<{ id: string; name: string; system_prompt: string }[]>([]);

  // ── Edit & Regenerate ──
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);

  // ── Suggested follow-ups ──
  const [suggestions, setSuggestions] = useState<Map<string, string[]>>(new Map());

  // ── Response length control ──
  const [responseLength, setResponseLength] = useState<"concise" | "normal" | "detailed">("normal");

  // ── Skill catalog drawer ──
  const [showSkillCatalog, setShowSkillCatalog] = useState(false);

  // ElevenLabs TTS + chat attachments
  const { speak, stop: stopSpeaking, isSpeaking, isLoading: isVoiceLoading } = useElevenLabsTts();
  const { attachments, isUploading, upload, remove, clearStaged } = useChatAttachments("mavis", "main");

  // Auto-poll async media generation jobs (music, video) and update messages on completion
  useMediaPoller(chatMessages as any, setChatMessages as any);
  const [isDragging, setIsDragging] = useState(false);

  // ── Activate a quick-specialist from the Agent Mode panel ──
  async function activateSpecialistFromPanel(spec: (typeof QUICK_SPECIALISTS)[number]) {
    const rawUrl = `${AGENCY_BASE}/${spec.agentId}`;
    try {
      const [specRes, { data: { user } }] = await Promise.all([
        fetch(rawUrl, { signal: AbortSignal.timeout(15000) }),
        supabase.auth.getUser(),
      ]);
      if (!user) { toast.error("Not signed in"); return; }
      if (!specRes.ok) throw new Error(`Could not fetch spec (${specRes.status})`);
      const specContent = await specRes.text();
      const { error } = await supabase.from("mavis_active_agency_specialists").upsert({
        user_id:      user.id,
        agent_id:     spec.agentId,
        agent_name:   spec.name,
        division:     spec.division,
        raw_url:      rawUrl,
        spec_content: specContent,
        activated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      setActiveSpecialist({ agent_id: spec.agentId, agent_name: spec.name, division: spec.division, spec_content: specContent });
      setAgentModeOn(true);
      toast.success(`${spec.name} activated — AGENT mode enabled`);
    } catch (err: any) {
      toast.error(`Activation failed: ${err?.message ?? "unknown error"}`);
    }
  }

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
  // Wait for an authenticated session before loading; retry on auth state changes
  // to avoid a race where getSession() returns null on cold mount.
  useEffect(() => {
    if (dbLoaded) return;
    let cancelled = false;

    const runLoad = async (userId: string) => {
      if (cancelled) return;
      try {
        // Init three-layer memory engine + load DB-backed runtime skills
        initSession(userId);
        loadRuntimeSkills(userId).catch(err => console.warn("[Skills] Runtime load failed:", err));

        // Load standing orders custom directives
        setCustomOrders(getCustomOrders());

        // Pre-load personas for picker
        supabase.from("personas").select("id, name, system_prompt").eq("is_active", true).eq("user_id", userId)
          .then(({ data }: any) => { if (!cancelled && data) setPickerPersonas(data as any); })
          .catch(() => {});

        // Load active agency specialist
        supabase.from("mavis_active_agency_specialists")
          .select("agent_id, agent_name, division, spec_content")
          .eq("user_id", userId)
          .maybeSingle()
          .then(({ data }: any) => { if (!cancelled && data) setActiveSpecialist(data); })
          .catch(() => {});

        const { data: convos } = await supabase
          .from("chat_conversations")
          .select("id, title")
          .eq("user_id", userId)
          .not("title", "ilike", "Council Board%")
          .order("updated_at", { ascending: false })
          .limit(1);

        if (cancelled) return;
        if (!convos?.length) { setDbLoaded(true); return; }

        const convoId = convos[0].id;
        setConversationId(convoId);

        const { data: msgs } = await supabase
          .from("chat_messages")
          .select("*")
          .eq("conversation_id", convoId)
          .order("created_at", { ascending: true })
          .limit(200);

        if (cancelled) return;
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
        if (!cancelled) setDbLoaded(true);
      }
    };

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await runLoad(session.user.id);
      }
      // Don't mark dbLoaded yet — wait for onAuthStateChange to fire with a session.
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      if (session?.user && !dbLoaded && !cancelled) {
        runLoad(session.user.id);
      }
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, [dbLoaded]);

  // ── SuperContext scout — runs once after auth + DB load ─────────────
  // Calls mavis-context-scout to assemble a rich context block (quests, goals,
  // tasks, journal, memories, user profile) that MAVIS uses as standing context.
  useEffect(() => {
    if (!dbLoaded || superContextLoaded.current) return;
    superContextLoaded.current = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const res = await supabase.functions.invoke("mavis-context-scout", {
          body: { user_id: session.user.id },
        });
        if (res.data?.context_block) {
          setSuperContext(res.data.context_block);
        }
      } catch { /* non-critical */ }
    })();
  }, [dbLoaded]);

  // ── Persist a single message to DB ───────────────────────
  const persistMessage = useCallback(async (msg: { role: string; content: string; mode?: string }, convoId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      // Register this write so the Realtime handler can skip it (avoids duplicates)
      const writeKey = `${msg.role}:${msg.content}`;
      recentWebWrites.current.set(writeKey, Date.now());
      setTimeout(() => recentWebWrites.current.delete(writeKey), 30_000);
      await supabase.from("chat_messages").insert({
        conversation_id: convoId,
        user_id: session.user.id,
        role: msg.role,
        content: msg.content,
        mode: msg.mode ?? "PRIME",
      });
      // Keep updated_at current so the mount-time query always finds this conversation first
      await supabase.from("chat_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convoId);
    } catch (err) {
      console.error("Failed to persist message:", err);
    }
  }, []);

  // ── Ensure a conversation exists, return its ID ──────────
  const ensureConversation = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;

      // Fast path: ID already in context
      if (conversationId) return conversationId;

      // Race condition safety: DB load may still be in flight — check DB before creating
      const { data: existing } = await supabase
        .from("chat_conversations")
        .select("id")
        .eq("user_id", session.user.id)
        .not("title", "ilike", "Council Board%")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        setConversationId(existing.id);
        return existing.id;
      }

      // No existing conversation — create one
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

  // ── Realtime: pick up messages written by Telegram (or any external source) ──
  // The web chat writes messages optimistically to state with temp IDs.
  // recentWebWrites tracks those to avoid duplicates when Realtime fires.
  useEffect(() => {
    if (!conversationId) return;

    const channel = (supabase as any)
      .channel(`chat-rt-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;

          // If we wrote this from the web chat ourselves, skip it
          const key = `${row.role}:${row.content}`;
          const writtenAt = recentWebWrites.current.get(key);
          if (writtenAt && Date.now() - writtenAt < 30_000) {
            recentWebWrites.current.delete(key);
            return;
          }

          // External message (from Telegram, etc.) — append to thread
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev; // already present
            return [
              ...prev,
              {
                id: row.id,
                role: row.role as "user" | "assistant",
                content: row.content,
                mode: row.mode ?? "PRIME",
                timestamp: new Date(row.created_at),
              },
            ];
          });
        },
      )
      .subscribe();

    return () => { (supabase as any).removeChannel(channel); };
  }, [conversationId, setChatMessages]);

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
  const lastAssistantMsgId = useMemo(() => {
    const assistantMsgs = chatMessages.filter((m) => m.role === "assistant" && !m.id.startsWith("streaming-") && m.content);
    return assistantMsgs.at(-1)?.id ?? null;
  }, [chatMessages]);
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

      const condensedComms = (chatMessages ?? [])
        .filter(m => m.id !== "init")
        .map(m => `[${m.role === "user" ? "OP" : "MAVIS"}${m.mode ? `/${m.mode}` : ""}] ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`)
        .join("\n");

      const snapshotData = {
        profile: { ...(profile ?? {}) },
        quests: (quests ?? []).map(q => ({ id: q.id, title: q.title, status: q.status, type: q.type, xp_reward: q.xp_reward })),
        skills: (skills ?? []).map(s => ({ id: s.id, name: s.name, category: s.category, tier: s.tier, proficiency: s.proficiency })),
        energySystems: (energySystems ?? []).map(e => ({ id: e.id, type: e.type, current_value: e.current_value, max_value: e.max_value })),
        councils: (councils ?? []).map(c => ({ id: c.id, name: c.name, role: c.role, class: c.class })),
        allies: (allies ?? []).map(a => ({ id: a.id, name: a.name, relationship: a.relationship, affinity: a.affinity })),
        inventory: (inventory ?? []).map(i => ({ id: i.id, name: i.name, type: i.type, rarity: i.rarity, quantity: i.quantity })),
        rituals: (rituals ?? []).map(r => ({ id: r.id, name: r.name, streak: r.streak, completed: r.completed })),
        journalCount: (journalEntries ?? []).length,
        vaultCount: (vaultEntries ?? []).length,
        storeItemCount: (storeItems ?? []).length,
        bpmSessionCount: (bpmSessions ?? []).length,
        timestamp: new Date().toISOString(),
      };

      const summary = `OmniSync @ Lv${profile?.level ?? "-"} [${profile?.rank ?? "-"}] | ${(quests ?? []).filter(q => q.status === "active").length} active quests | ${(skills ?? []).length} skills | ${(chatMessages ?? []).length - 1} msgs in thread`;

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
    setAgentSteps([]);

    const abortController = new AbortController();
    abortRef.current = abortController;

    const convoId = await ensureConversation();

    // ── Edit mode: truncate history to before the edited message ──
    let effectiveMessages = chatMessages;
    if (editingMsgId) {
      const editIdx = chatMessages.findIndex((m) => m.id === editingMsgId);
      if (editIdx !== -1) {
        effectiveMessages = chatMessages.slice(0, editIdx);
        setChatMessages(effectiveMessages);
      }
      setEditingMsgId(null);
    }

    const stagedAttachments = [...attachments];
    const userMsg = {
      id: `u-${Date.now()}`,
      role: "user" as const,
      content,
      mode: chatMode,
      timestamp: new Date(),
      stagedAttachments,
    };
    setChatMessages((prev) => [...prev, userMsg]);
    clearStaged();
    setIsLoading(true);

    if (convoId) {
      persistMessage({ role: "user", content, mode: chatMode }, convoId).catch(() => {});
    }

    const history = effectiveMessages
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
      // ── GitHub Repo Analysis (runs FIRST — before agentModeOn) ───────────────
      // Detects github.com/owner/repo in any mode and routes to mavis-code-agent.
      // This must be before the agentModeOn check so engineering specialists can
      // trigger the SE agent loop even when Agent Mode is active.
      const githubMatch = content.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/i);
      if (githubMatch && userId) {
        const [, owner, rawRepo] = githubMatch;
        // Strip .git suffix so "repo.git" doesn't break the GitHub API call
        const repo = rawRepo.replace(/\.git$/i, "");
        const task = content.replace(/https?:\/\/github\.com\/[^\s]+/gi, "").trim() ||
          "Provide a comprehensive analysis: architecture overview, key patterns, file structure, dependencies, security considerations, and technical assessment.";
        streamingId = `gh-${Date.now()}`;
        const specialistTag = activeSpecialist ? `**[${activeSpecialist.agent_name}]**` : "**[CODE AGENT]**";
        setChatMessages((prev) => [...prev, {
          id: streamingId,
          role: "assistant" as const,
          content: `${specialistTag} Routing to mavis-code-agent for analysis of **${owner}/${repo}**…\n\n_Task: ${task}_`,
          mode: chatMode,
          timestamp: new Date(),
        }]);
        try {
          const { data: codeData, error: codeErr } = await supabase.functions.invoke("mavis-code-agent", {
            body: {
              task,
              owner,
              repo,
              branch: "main",
              specialist_name: activeSpecialist?.agent_name,
              specialist_context: activeSpecialist?.spec_content?.slice(0, 4000),
            },
          });
          if (codeErr) throw codeErr;
          // Friendly message when the repo is private or doesn't exist
          const isNotFound = /404|not found|repository not found/i.test(JSON.stringify(codeData));
          if (isNotFound || codeData?.error) {
            const notFoundMsg =
              `**[CODE AGENT]** Could not access **${owner}/${repo}**.\n\n` +
              `**Possible causes:**\n` +
              `- The repository is **private** — add your GitHub Personal Access Token in **Settings → API Keys** to unlock private repos\n` +
              `- The URL may be incorrect — double-check the owner and repo name\n` +
              `- The repo may have been deleted or renamed\n\n` +
              `_For a private repo audit, share the zip file in this chat and I can analyze it directly._`;
            setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat({
              id: `ca-${Date.now()}`, role: "assistant" as const, content: notFoundMsg, mode: chatMode, timestamp: new Date(),
            }));
            if (convoId) persistMessage({ role: "assistant", content: notFoundMsg, mode: chatMode }, convoId);
          } else {
            const codeText = codeData?.summary ?? codeData?.content ?? codeData?.response ?? codeData?.result ?? JSON.stringify(codeData);
            const codeMsg = { id: `ca-${Date.now()}`, role: "assistant" as const, content: codeText, mode: chatMode, timestamp: new Date() };
            setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat(codeMsg));
            if (convoId) persistMessage({ role: "assistant", content: codeText, mode: chatMode }, convoId);
          }
        } catch (err: any) {
          const errMsg = err?.message ?? "unknown error";
          const isAuthErr = /auth|token|PAT|github not connected/i.test(errMsg);
          const is404 = /404|not found/i.test(errMsg);
          setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat({
            id: `err-${Date.now()}`,
            role: "assistant" as const,
            content: (is404 || isAuthErr)
              ? `**[CODE AGENT]** **${owner}/${repo}** is private or doesn't exist.\n\n**To audit a private repo:**\n1. Go to **Settings → API Keys** and add your GitHub Personal Access Token\n2. Or share the repo as a zip file in this chat\n\nPublic repos work without any setup — just paste the URL.`
              : `**[CODE AGENT ERROR]** ${errMsg}`,
            mode: chatMode,
            timestamp: new Date(),
          }));
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // ── Direct Image Generation (any mode, no specialist required) ──────────────
      // Fires when the user explicitly requests a visual — image, poster, logo, etc.
      // Bypasses the LLM so the image actually gets generated rather than described.
      const IMAGE_NOUNS = /\b(image|photo|illustration|logo|poster|banner|artwork|graphic|icon|thumbnail|mockup|flyer|picture|visual|infographic)\b/i;
      const IMAGE_VERBS = /\b(generate|create|make|design|draw|render|produce|build|give me)\b/i;
      const isImageRequest = IMAGE_VERBS.test(content) && IMAGE_NOUNS.test(content);
      // Image gen fires before any mode routing — agent mode ON does not bypass it
      if (isImageRequest) {
        const imagePrompt = content
          .replace(/^(please\s+)?(generate|create|make|design|draw|render|produce|build|give me)\s+(an?\s+)?(image|photo|illustration|logo|poster|banner|artwork|graphic|icon|thumbnail|mockup|flyer|picture|visual|infographic)\s+(of\s+|for\s+)?/i, "")
          .replace(/\bfor me\b|\bplease\b/gi, "")
          .trim() || content;
        streamingId = `img-${Date.now()}`;
        setChatMessages((prev) => [...prev, {
          id: streamingId,
          role: "assistant" as const,
          content: `🎨 Generating: _${imagePrompt.slice(0, 120)}_…`,
          mode: chatMode,
          timestamp: new Date(),
        }]);
        try {
          const { data: imgData } = await supabase.functions.invoke("mavis-image-gen", {
            body: { prompt: `${imagePrompt}. Professional quality, high resolution.` },
          });
          if (imgData?.error) throw new Error(imgData.error);
          const imgUrl = imgData?.url;
          if (!imgUrl) throw new Error("No image URL returned");
          const imgText = `![${imagePrompt.slice(0, 60)}](${imgUrl})\n\n_Generated by ${imgData.provider ?? "AI"} · Prompt: "${imagePrompt.slice(0, 100)}"_`;
          const imgMsg = { id: `img-${Date.now()}`, role: "assistant" as const, content: imgText, mode: chatMode, timestamp: new Date() };
          setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat(imgMsg));
          if (convoId) persistMessage({ role: "assistant", content: imgText, mode: chatMode }, convoId);
        } catch (err: any) {
          const errMsg = err?.message ?? "Image generation failed";
          setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat({
            id: `err-${Date.now()}`,
            role: "assistant" as const,
            content: `**[IMAGE GEN]** ${errMsg}\n\nFor higher quality, add an image provider key to Supabase secrets: \`GEMINI_API_KEY\` (Imagen 4), \`FAL_API_KEY\` (Flux Pro), or \`OPENAI_API\` (DALL-E 3).`,
            mode: chatMode,
            timestamp: new Date(),
          }));
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // ── Smart mode detection: MAVIS self-manages the agent toggle ───────────────
      // Intent is classified on every message. MAVIS activates agent mode when tools
      // are needed and deactivates when the request is clearly conversational —
      // so Calvin never has to manually flip the switch.

      const AGENT_INTENT: RegExp[] = [
        // Search / browse
        /\bsearch (the )?(web|internet|online|for)\b/i,
        /\blook (this |it |up )?up( online| on the web)?\b/i,
        /\bfind (me |the |latest |current )?(news|article|result|price|listing|info|data|answer)\b/i,
        /\bbrowse\b/i,
        // Personal data: calendar, tasks, quests, memories, email
        /\b(show|check|get|pull|list|see|what.?s|what are) (my |the )?(calendar|schedule|events?|meetings?|appointments?)\b/i,
        /\bwhat.?s (on )?(my )?(calendar|agenda|schedule|plate|task list|todo)\b/i,
        /\b(show|check|get|pull|list|see|what.?s|what are) (my )?(tasks?|todos?|quests?|reminders?|inbox|goals?)\b/i,
        /\b(show|check|get|pull|list|see|what.?s|what are) (my )?(emails?|messages?|notifications?|slack)\b/i,
        /\b(load|pull|show|get|access|read) (my |the )?(memories|notes|journal|vault|logs?|history)\b/i,
        /\bwhat did (i|we|you) (do|work on|discuss|talk about|complete|accomplish)\b/i,
        /\bwhat.?s (happening|trending|new|in the news|going on)\b/i,
        // Named integrations — any mention = likely needs tools
        /\b(google|gmail|gcal|google calendar|google drive|notion|slack|discord|spotify|shopify|stripe|airtable|linear|telegram|twilio|whoop|oura|strava|apify|gumroad|heygen|vapi)\b/i,
        // Execute / run actions
        /\b(run|execute|trigger|fire|invoke|call|activate) (the |a |this |that )?(code|script|test|function|command|workflow|automation)\b/i,
        /\b(create|add|update|delete|remove|edit|change|set|mark|complete|archive|schedule)\b.{0,40}(task|quest|event|meeting|reminder|note|entry|item|goal|habit)\b/i,
        /\b(send|reply to|forward|draft and send)\b.{0,40}(email|message|slack|text|dm)\b/i,
        /\b(deploy|publish|push|release|ship)\b/i,
        /\b(fetch|pull|access|get|retrieve)\b.*(data|api|live|latest|current|real.?time)\b/i,
        // Analysis / metrics / live systems
        /\banalyze (my |the )?(current )?(setup|system|app|data|performance|stats|metrics|portfolio|business|codebase|config)\b/i,
        /\b(how.?s|what.?s) ?(my |the )?(performance|analytics?|stats?|metrics?|revenue|sales|traffic|ranking)\b/i,
        /\b(report|dashboard|kpi|summary) (on|for|of|about)\b/i,
        /\bcheck (my |the )?(account|balance|analytics|stats|metrics|notifications|news)\b/i,
        // Imperative / do-it commands
        /\b(do it|do that|make it happen|carry (it|that) out|take care of (it|that)|handle (it|that))\b/i,
        /\b(build me|make me|generate (me )?a)\b.{0,40}(app|website|script|tool|template|spreadsheet|report)\b/i,
        /\b(today.?s|this week.?s|upcoming|recent|latest)\b.{0,30}(tasks?|events?|meetings?|emails?|deadlines?)\b/i,
      ];

      const CHAT_ONLY_INTENT: RegExp[] = [
        // Pure conversation openers
        /^(hi+|hey+|hello|good (morning|afternoon|evening|night)|howdy)\b/i,
        /^(how are you|how.?s it going|how.?re you doing)\b/i,
        // General knowledge (no personal/live data qualifiers)
        /^(what (is|are|does|do|was|were)|explain|describe|define|clarify|elaborate)\b(?!.*(my |mine |latest |current |live |today|this week))/i,
        // Opinion / reflection (not a request to act)
        /\b(your (thoughts?|opinion|take|view|perspective))\b(?!.*(send|post|email|schedule))/i,
        /\b(what do you think|what would you (say|recommend|suggest))\b/i,
        // Pure creative with no publish intent
        /^(write|draft|compose|brainstorm|outline)\b.*(poem|story|essay|creative|caption|tagline|slogan)\b(?!.*(send|publish|post|upload|submit))/i,
        // Meta / help
        /\b(how do i|how does (mavis|this|that) work|what can (you|mavis) (do|help))\b/i,
      ];

      const requiresAgent = AGENT_INTENT.some(p => p.test(content));
      const isConversational = !requiresAgent && CHAT_ONLY_INTENT.some(p => p.test(content));

      // Capture ref value before any mutation so routing stays consistent this tick
      const wasAutoActivated = agentAutoActivated.current;

      // Auto-activate: message needs tools and toggle is currently off
      const autoAgent = requiresAgent && !agentModeOn && Boolean(userId);
      if (autoAgent) {
        setAgentModeOn(true);
        agentAutoActivated.current = true;
      }

      // Auto-deactivate: clearly conversational + toggle was set by us, not the user
      const autoDeactivate = isConversational && agentModeOn && wasAutoActivated;
      if (autoDeactivate) {
        setAgentModeOn(false);
        agentAutoActivated.current = false;
      }

      // Effective routing for THIS message (state update is async; ref/local vars are not)
      const routeToAgent = (agentModeOn && !autoDeactivate) || autoAgent;

      // ── Agent Mode: route to mavis-agent with full specialist context ─────────
      // chatMode === "FLOW" always routes to Flowise below, even when agentModeOn is on.
      if (routeToAgent && chatMode !== "FLOW" && userId) {
        streamingId = `streaming-${Date.now()}`;
        setChatMessages((prev) => [...prev, {
          id: streamingId,
          role: "assistant" as const,
          content: "⚙ Thinking…",
          mode: chatMode,
          timestamp: new Date(),
        }]);
        setAgentThinking("Engaging agent loop…");
        try {
          // ── Specialist Dispatcher: try division-specific tool routes first ────────
          if (activeSpecialist) {
            const dispatchResult = await dispatchToSpecialist(
              content,
              activeSpecialist,
              userId,
              supabase,
              (label) => setAgentThinking(`${activeSpecialist.agent_name}: ${label}…`),
            );
            if (dispatchResult.handled) {
              const dispatchMsg = {
                id: `d-${Date.now()}`,
                role: "assistant" as const,
                content: dispatchResult.response ?? "",
                mode: chatMode,
                timestamp: new Date(),
              };
              setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat(dispatchMsg));
              if (convoId) persistMessage({ role: "assistant", content: dispatchResult.response ?? "", mode: chatMode }, convoId);
              setIsLoading(false);
              setAgentThinking(null);
              return;
            }
          }
          // ── Build full MAVIS context for the agent loop ───────────────────────────
          setAgentThinking("Building context…");
          const agentSystemPrompt = await (fullCtx
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

          // ── Stream via mavis-agent with live SSE progress updates ────────────────
          setAgentThinking("Executing…");
          const onAgentToken = (_tok: string, accumulated: string) => {
            if (cancelledRef.current) return;
            setAgentThinking(null);
            setChatMessages((prev) => prev.map((m) =>
              m.id === streamingId ? { ...m, content: accumulated } : m
            ));
          };
          const agentResult = await streamAgentMessage(
            content,
            agentSystemPrompt,
            history,
            { mode: chatMode, conversationId, appState: compactState, chatKind: "mavis", threadRef: "main", attachmentIds: [] },
            onAgentToken,
            (toolInfo) => { if (!cancelledRef.current) setAgentThinking(toolInfo); },
            abortController.signal,
          );
          const agentText = agentResult.cleanText || agentResult.rawText || "MAVIS returned an empty response. Please try again.";
          const toolsUsed: string[] = (agentResult.fnData as any)?.toolsUsed ?? [];
          const actionsQueued: number = (agentResult.fnData as any)?.actionsQueued ?? 0;
          setLastAgentMeta({ toolsUsed, actionsQueued });
          const agentExecConfirmed = (agentResult.executionResults ?? []).filter((r) => r.status === "success");
          if (agentExecConfirmed.length > 0) {
            await new Promise((r) => setTimeout(r, 500));
            await refetchAll();
            if (userId) captureProceduralMemory(userId, content, agentExecConfirmed).catch(() => {});
          }
          const agentMsg = {
            id: `a-${Date.now()}`,
            role: "assistant" as const,
            content: agentText,
            mode: chatMode,
            timestamp: new Date(),
            _agentMeta: { toolsUsed, actionsQueued },
          };
          setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat(agentMsg));
          if (agentResult.conversationId) setConversationId(agentResult.conversationId);
          if (convoId) persistMessage({ role: "assistant", content: agentText, mode: chatMode }, convoId);
          speakText(agentText);
        } catch (err: any) {
          setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat({
            id: `err-${Date.now()}`,
            role: "assistant" as const,
            content: `Agent error: ${err?.message ?? "unknown"}`,
            mode: chatMode,
            timestamp: new Date(),
          }));
        } finally {
          setIsLoading(false);
          setAgentThinking(null);
        }
        return;
      }

      // ── FLOW mode (Flowise visual agent chains) ──────────────
      if (chatMode === "FLOW") {
        streamingId = `flow-${Date.now()}`;
        setChatMessages((prev) => [...prev, {
          id: streamingId, role: "assistant" as const,
          content: "", mode: chatMode, timestamp: new Date(),
        }]);
        try {
          const { data: flowData, error: flowErr } = await supabase.functions.invoke("mavis-flowise", {
            body: { question: content, chatId: userId, history },
          });
          if (flowErr) throw flowErr;
          const flowText = flowData?.content ?? JSON.stringify(flowData);
          const flowMsg = {
            id: `f-${Date.now()}`,
            role: "assistant" as const,
            content: flowText,
            mode: chatMode,
            timestamp: new Date(),
          };
          setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat(flowMsg));
          if (convoId) persistMessage({ role: "assistant", content: flowText, mode: chatMode }, convoId);
        } catch (err: any) {
          setChatMessages((prev) => prev.filter((m) => m.id !== streamingId).concat({
            id: `err-${Date.now()}`, role: "assistant" as const,
            content: `[FLOW ERROR] ${err?.message ?? "unknown"} — check that FLOWISE_BASE_URL is set in Supabase secrets`,
            mode: chatMode, timestamp: new Date(),
          }));
        } finally {
          setIsLoading(false);
        }
        return;
      }

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
      // SuperContext — assembled by mavis-context-scout at session start (OpenHuman pattern)
      if (superContext) systemPrompt += `\n\n${superContext}`;
      if (responseLength === "concise") systemPrompt += "\n\n[RESPONSE LENGTH: Be concise — 2-4 sentences unless more is genuinely needed.]";
      else if (responseLength === "detailed") systemPrompt += "\n\n[RESPONSE LENGTH: Be thorough and detailed — elaborate with examples where useful.]";
      if (selectedPersonaPrompt) systemPrompt += `\n\n--- ACTIVE PERSONA ---\n${selectedPersonaPrompt}\n---`;

      // In text-only modes, stop MAVIS from promising executions it can't deliver
      const NON_AGENT_MODES = ["PRIME", "ENRYU", "SOVEREIGN", "QUEST", "FORGE", "WATCHTOWER", "SALES", "MARKET", "GAME_MASTER", "WEBMASTER"];
      const ACTION_KEYWORDS = /\b(execute|run|perform|analyze my (setup|system|app|account|data)|check my (setup|data|account|stats)|access|audit|search (the )?web|browse|fetch|build me|deploy|take action|do (that|this|it)|carry out|make it happen|generate and)\b/i;
      if (NON_AGENT_MODES.includes(chatMode) && ACTION_KEYWORDS.test(content) && !agentModeOn) {
        systemPrompt +=
          `\n\n[EXECUTION LIMITS — IMPORTANT]\n` +
          `You are in ${chatMode} mode, which is text-only. You CANNOT execute code, browse URLs, access APIs, query databases, or perform real actions.\n` +
          `When the user asks you to "execute", "run", "analyze my setup", or do anything that requires system access:\n` +
          `1. Clearly state you are in text-only ${chatMode} mode and cannot perform real executions.\n` +
          `2. Direct them to enable **Agent Mode** (the AGENT toggle in the top bar) for tool-use execution.\n` +
          `3. For images: tell them to say "generate image: [description]" — it fires directly without needing AGENT mode.\n` +
          `4. For GitHub repo audits: paste the URL directly in the chat — it routes automatically.\n` +
          `5. For code execution & deep analysis: suggest the **Agent Console** (/agent-console).\n` +
          `DO NOT say "I'll proceed", "let me analyze", "hold on while I fetch", or "I'll execute" — these are false promises you cannot keep in ${chatMode} mode.`;
      }

      if (activeSpecialist) {
        const divLabel = activeSpecialist.division.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        systemPrompt +=
          `\n\n═══════════════════════════════════════════\n` +
          `ACTIVE AGENCY SPECIALIST: ${activeSpecialist.agent_name} [${divLabel}]\n` +
          `═══════════════════════════════════════════\n` +
          `You are currently operating as ${activeSpecialist.agent_name}, a specialist from The Agency. ` +
          `Adopt their expertise, frameworks, terminology, and professional voice in every response. ` +
          `Start every response with a bold specialist tag: **[${activeSpecialist.agent_name}]** on its own line, then your response. ` +
          `You still have all MAVIS tools and memory — but think, reason, and communicate as this specialist.\n\n` +
          activeSpecialist.spec_content.slice(0, 8000) +
          `\n═══ END SPECIALIST OVERLAY ═══`;
      }
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
              (stepEvent) => {
                if (!cancelledRef.current) {
                  setAgentSteps(prev => {
                    const label = stepEvent.type ? `${stepEvent.type}` : "";
                    if (stepEvent.step === "result" && prev.length > 0 && prev[prev.length - 1].type === stepEvent.type) {
                      return [...prev.slice(0, -1), { ...stepEvent, label }];
                    }
                    return [...prev, { ...stepEvent, label }];
                  });
                }
              },
              abortController.signal,
            );

      if (cancelledRef.current) {
        setChatMessages((prev) => prev.filter((m) => m.id !== streamingId));
        setAgentThinking(null);
        setAgentSteps([]);
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

      // Fire-and-forget: generate suggested follow-ups
      if (cleanText.length > 80) {
        const msgId = assistantMsg.id;
        (async () => {
          try {
            const suggestSys = "You are a suggestion engine. Based on the assistant's last response, suggest 3 short follow-up questions or actions the user might want to take next. Reply with ONLY a JSON array of 3 strings, e.g. [\"Question 1\", \"Question 2\", \"Question 3\"]. No other text.";
            const suggestMsgs = [
              { role: "user", content: `User asked: ${content}\n\nAssistant replied: ${cleanText.slice(0, 800)}` },
            ];
            const result = await invokeAI(suggestSys, suggestMsgs, "PRIME");
            const match = result.match(/\[[\s\S]*?\]/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              if (Array.isArray(parsed)) {
                setSuggestions((prev) => new Map(prev).set(msgId, parsed.slice(0, 3)));
              }
            }
          } catch { /* non-critical */ }
        })();
      }
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
      setAgentSteps([]);
      abortRef.current = null;
    }
  }, [input, chatMessages, isLoading, chatMode, agentModeOn, agentThinking, profile, quests, tasks, skills, journalEntries, vaultEntries, conversationId, setChatMessages, setConversationId, refetchAll, ensureConversation, persistMessage, saveMemoriesFromResponse, speakText, attachments, clearStaged, editingMsgId, responseLength, activeSpecialist]);

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

  // ── Regenerate last assistant response ──
  const regenerate = useCallback(() => {
    const msgs = chatMessages.filter((m) => m.id !== "init");
    // Find the last user message
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    // Remove the last assistant message
    const lastAssistantIdx = msgs.map((m) => m.role).lastIndexOf("assistant");
    if (lastAssistantIdx === -1) return;
    const withoutLast = chatMessages.filter((_, i) => {
      const filtered = chatMessages.filter((m) => m.id !== "init");
      return chatMessages[i].id !== filtered[lastAssistantIdx].id;
    });
    setChatMessages(withoutLast);
    sendMessage(lastUserMsg.content);
  }, [chatMessages, setChatMessages, sendMessage]);

  // ── Pending action helpers ──────────────────────────────────
  function getActionLabel(action: ParsedAction): string {
    const p = action.payload as any;
    const name = p?.title || p?.name || p?.display_name || p?.quest_id || p?.skill_id || p?.entry_id || p?.id || "";
    const typeLabel = action.type.replace(/_/g, " ");
    return name ? `${typeLabel}: "${String(name).slice(0, 50)}"` : typeLabel;
  }

  async function approvePendingAction(index: number) {
    const result = pendingActions[index];
    if (!result) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await supabase.functions.invoke("mavis-actions", {
        body: { actions: [{ type: result.action.type, params: result.action.payload }] },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setPendingActions(prev => prev.filter((_, i) => i !== index));
      refetchAll?.();
    } catch (err) {
      console.error("Failed to execute approved action:", err);
    }
  }

  function rejectPendingAction(index: number) {
    setPendingActions(prev => prev.filter((_, i) => i !== index));
  }

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
    <div className="flex gap-3 h-full">
    <div
      className={`flex flex-col flex-1 min-w-0 gap-2 pb-0 relative transition-colors ${isDragging ? "bg-primary/5 ring-1 ring-inset ring-primary/20 rounded-lg" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) upload(files);
      }}
    >
      {isDragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-primary/50 rounded-xl px-8 py-4 bg-background/80">
            <p className="text-sm font-mono text-primary">Drop files to attach</p>
          </div>
        </div>
      )}
      <PageHeader
        title="MAVIS"
        subtitle={`Mode: ${currentMode.label} // Supreme Intelligence`}
        icon={<Cpu size={18} />}
        actions={
          <div className="flex items-center gap-1 sm:gap-3">
            <button
              onClick={() => { setAgentModeOn((v) => !v); setLastAgentMeta(null); agentAutoActivated.current = false; }}
              className={`flex items-center gap-1 sm:gap-1.5 text-xs font-mono rounded px-1.5 sm:px-2 py-1 border transition-all ${
                agentModeOn
                  ? "border-violet-500/60 bg-violet-500/15 text-violet-300"
                  : "border-border/60 text-muted-foreground hover:text-violet-300 hover:border-violet-500/40"
              }`}
              title={agentModeOn ? "Agent Mode ON — click to disable" : "Agent Mode OFF — click to enable"}
            >
              <Cpu size={12} />
              <span className="hidden sm:inline">{agentModeOn ? "Agent: ON" : "Agent: OFF"}</span>
              {agentModeOn && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
            </button>
            <button
              onClick={() => navigate("/council-board")}
              className="flex items-center gap-1 sm:gap-1.5 text-xs font-mono text-amber-400 hover:text-amber-300 border border-amber-900/40 hover:border-amber-400/40 rounded px-1.5 sm:px-2 py-1 transition-all"
              title="Open Council Board"
            >
              <Users size={12} />
              <span className="hidden sm:inline">Council</span>
            </button>
            <button
              onClick={handleOmniSync}
              disabled={isSyncing}
              className="flex items-center gap-1 sm:gap-1.5 text-xs font-mono text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 hover:border-cyan-400/40 rounded px-1.5 sm:px-2 py-1 transition-all disabled:opacity-40"
              title="OmniSync — sync context"
            >
              {isSyncing ? (
                <span className="w-3 h-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin block" />
              ) : (
                <Database size={12} />
              )}
              <span className="hidden sm:inline">OmniSync</span>
            </button>
            <button
              onClick={() => setShowSkillCatalog(true)}
              className="flex items-center gap-1 sm:gap-1.5 text-xs font-mono text-muted-foreground hover:text-primary border border-border/60 hover:border-primary/40 rounded px-1.5 sm:px-2 py-1 transition-all"
              title="Browse skills"
            >
              <BookOpen size={12} />
              <span className="hidden sm:inline">Skills</span>
            </button>
            <button
              onClick={clearChat}
              className="flex items-center gap-1 sm:gap-1.5 text-xs font-mono text-muted-foreground hover:text-primary border border-border/60 hover:border-primary/40 rounded px-1.5 sm:px-2 py-1 transition-all"
              title="New conversation"
            >
              <Plus size={12} />
              <span className="hidden sm:inline">New Chat</span>
            </button>
          </div>
        }
      />

      {/* Active Agency Specialist banner */}
      <AnimatePresence>
        {activeSpecialist && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center justify-between px-4 py-2 bg-violet-500/10 border-b border-violet-500/20 shrink-0"
          >
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[11px] font-mono text-violet-300">
                SPECIALIST ACTIVE —{" "}
                <strong className="text-violet-200">{activeSpecialist.agent_name}</strong>
                <span className="text-violet-500 ml-1">
                  [{activeSpecialist.division.replace(/-/g, " ").toUpperCase()}]
                </span>
              </span>
            </div>
            <button
              onClick={async () => {
                const { data: { user } } = await (supabase as any).auth.getUser();
                if (!user) return;
                await (supabase as any).from("mavis_active_agency_specialists").delete().eq("user_id", user.id);
                setActiveSpecialist(null);
              }}
              className="text-[10px] font-mono text-violet-600 hover:text-violet-400 transition-colors"
            >
              Deactivate ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Agent Mode meta bar — shows after agent response */}
      <AnimatePresence>
        {agentModeOn && lastAgentMeta && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-violet-500/20 bg-violet-950/20 text-xs font-mono text-violet-300"
          >
            <Cpu size={10} className="text-violet-400 shrink-0" />
            {lastAgentMeta.toolsUsed.length > 0 ? (
              <span>Tools used: [{lastAgentMeta.toolsUsed.join(", ")}]</span>
            ) : (
              <span>Agent mode active</span>
            )}
            {lastAgentMeta.actionsQueued > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-amber-400">{lastAgentMeta.actionsQueued} action{lastAgentMeta.actionsQueued !== 1 ? "s" : ""} queued</span>
              </>
            )}
            <button
              onClick={() => setLastAgentMeta(null)}
              className="ml-auto text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X size={10} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pending confirmations banner */}
      {pendingActions.length > 0 && (
        <div className="space-y-1.5 mb-1">
          {pendingActions.map((result, i) => {
            const action = result.action;
            const label = getActionLabel(action);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-2 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5 text-xs font-mono"
              >
                <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                <span className="flex-1 text-amber-300 truncate">Confirm: {label}</span>
                <button
                  onClick={() => approvePendingAction(i)}
                  className="px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 text-xs"
                >
                  Approve
                </button>
                <button
                  onClick={() => rejectPendingAction(i)}
                  className="px-2 py-0.5 rounded text-muted-foreground hover:text-destructive text-xs"
                >
                  Reject
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Standing Orders Panel */}
      <AnimatePresence>
        {showOrdersPanel && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="border border-primary/30 rounded-lg bg-primary/5 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-primary uppercase tracking-widest">Standing Orders — Custom Directives</span>
              <button onClick={() => setShowOrdersPanel(false)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </div>
            {customOrders.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground">No custom directives. Core standing orders are always active.</p>
            ) : (
              <div className="space-y-1">
                {customOrders.map((o) => (
                  <div key={o} className="flex items-center gap-2">
                    <span className="text-xs font-mono flex-1 text-foreground">• {o}</span>
                    <button onClick={() => setConfirmRemoveOrder(o)} className="text-muted-foreground hover:text-destructive"><X size={10} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={newOrder} onChange={(e) => setNewOrder(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newOrder.trim()) { addStandingOrder(newOrder.trim()); setCustomOrders(getCustomOrders()); setNewOrder(""); } }}
                placeholder="Add directive..." className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground" />
              <button onClick={() => { if (newOrder.trim()) { addStandingOrder(newOrder.trim()); setCustomOrders(getCustomOrders()); setNewOrder(""); } }}
                className="px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-mono hover:bg-primary/20">Add</button>
            </div>
            <p className="text-xs font-mono text-muted-foreground">Core directives are always active. These are your custom additions.</p>
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
              <span className="text-xs font-mono text-primary uppercase tracking-widest">Inject Persona Context</span>
              <button onClick={() => setShowPersonaPicker(false)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
            </div>
            {pickerPersonas.length === 0 ? (
              <p className="text-xs font-mono text-muted-foreground">No personas found. Create one on the Personas page.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {pickerPersonas.map((p) => (
                  <button key={p.id}
                    onClick={() => { setSelectedPersonaPrompt(p.system_prompt); setSelectedPersonaName(p.name); setShowPersonaPicker(false); }}
                    className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${selectedPersonaName === p.name ? "bg-primary/20 border-primary/40 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground"}`}
                  >{p.name}</button>
                ))}
                {selectedPersonaName && (
                  <button onClick={() => { setSelectedPersonaPrompt(null); setSelectedPersonaName(null); }}
                    className="text-xs font-mono px-2 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10">Clear</button>
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
                    <p className="text-xs font-mono text-muted-foreground">{m.desc}</p>
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
          <span className="text-xs font-mono px-2 py-1 rounded bg-primary/10 border border-primary/30 text-primary">{selectedPersonaName}</span>
        )}
        <button onClick={() => setShowPersonaPicker((v) => !v)} title="Inject persona context"
          className="p-2 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors text-xs font-mono">
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
        <button onClick={() => setRealtimeVoiceOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-cyan-400/40 text-cyan-400/70 hover:text-cyan-400 hover:bg-cyan-400/10 text-xs font-mono transition-all"
          title="Realtime voice — OpenAI WebRTC, ultra-low latency">
          <Zap size={12} /> REALTIME
        </button>
      </div>
      </div>

      {/* MAVIS Agent Loop — live ReAct step display */}
      {isLoading && agentSteps.length > 0 && (
        <div className="mx-0 mb-1 rounded-lg border border-purple-500/20 bg-purple-950/20 p-3 text-xs font-mono">
          <div className="mb-1 text-purple-400 font-semibold">⚡ MAVIS Agent Loop</div>
          {agentSteps.map((s, i) => (
            <div key={i} className={`flex items-center gap-2 py-0.5 ${s.step === "result" ? (s.ok ? "text-green-400" : "text-red-400") : s.step === "retry" ? "text-yellow-400" : "text-purple-300"}`}>
              <span>{s.step === "actions_start" ? `🔄 iter ${s.iteration}` : s.step === "action" ? "⏳" : s.step === "result" ? (s.ok ? "✓" : "✗") : s.step === "retry" ? "↻" : "·"}</span>
              <span>{s.type ?? s.step}{s.count ? ` (${s.count} actions)` : ""}{s.step === "result" && s.preview ? `: ${s.preview.slice(0, 80)}` : ""}</span>
            </div>
          ))}
        </div>
      )}

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
                <span className="text-xs font-mono text-muted-foreground">
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
                                <span className="text-xs font-mono text-violet-400/80 truncate max-w-[260px]">
                                  ⚙ {agentThinking}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="mavis-prose">
                              <MarkdownRenderer
                                content={msg.content}
                                onOpenArtifact={(code, lang) => { setArtifactContent(code); setArtifactLang(lang); }}
                              />
                            </div>
                          )}
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
                          {/* Auto-detect audio / video / HTML poster URLs in message text */}
                          {msg.role === "assistant" && (
                            <InlineMediaPlayer
                              content={msg.content}
                              imageUrl={(msg as any).imageUrl}
                            />
                          )}
                          {(msg as any).sources?.length > 0 && (
                            <div className="mt-2 flex flex-col gap-0.5">
                              {(msg as any).sources.map((s: { title: string; url: string }, i: number) => (
                                <a
                                  key={i}
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-mono text-cyan-400/80 hover:text-cyan-300 underline underline-offset-2 truncate block max-w-[280px]"
                                >
                                  [{i + 1}] {s.title}
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {(msg as any).stagedAttachments?.length > 0 && (
                            <ChatMediaPreview attachments={(msg as any).stagedAttachments} />
                          )}
                          <p className="text-xs font-body leading-relaxed">{msg.content}</p>
                        </>
                      )}
                      <div className="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
                        {(msg as any).searched && (
                          <span className="text-xs font-mono text-cyan-400 border border-cyan-900/40 rounded px-1.5 py-0.5">
                            🔍 web search
                          </span>
                        )}
                        {(msg as any).iterations != null && (
                          <span className="text-xs font-mono text-violet-400 border border-violet-900/40 rounded px-1.5 py-0.5">
                            ⚙ {(msg as any).iterations} step{(msg as any).iterations !== 1 ? "s" : ""}
                          </span>
                        )}
                        {(msg as any).actionsExecuted > 0 && (
                          <span className="text-xs font-mono text-primary border border-primary/30 rounded px-1.5 py-0.5">
                            ⚡ {(msg as any).actionsExecuted} action{(msg as any).actionsExecuted > 1 ? "s" : ""} executed
                          </span>
                        )}
                        {msg.mode === "TELEGRAM" && (
                          <span className="text-xs font-mono text-sky-400/70 border border-sky-400/20 rounded px-1.5 py-0.5">
                            📱 Telegram
                          </span>
                        )}
                        {msg.mode && msg.mode !== "TELEGRAM" && msg.role === "assistant" && !(msg as any).searched && !(msg as any).actionsExecuted && (msg as any).iterations == null && (
                          <span className="text-xs font-mono text-muted-foreground">[{msg.mode}]{(msg as any).model ? ` · ${(msg as any).model}` : ""}</span>
                        )}
                        <span className="text-xs font-mono text-muted-foreground ml-auto">
                          {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {/* Suggested follow-ups — only on the last assistant message */}
                      {msg.role === "assistant" && msg.id === lastAssistantMsgId && suggestions.has(msg.id) && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {(suggestions.get(msg.id) ?? []).map((s, i) => (
                            <button
                              key={i}
                              onClick={() => sendMessage(s)}
                              className="text-xs font-mono text-muted-foreground hover:text-primary border border-border/50 hover:border-primary/30 rounded-full px-2.5 py-1 transition-all"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => {
                          if (msg.role === "user") {
                            setEditingMsgId(msg.id);
                            setInput(msg.content);
                          } else {
                            copyMessage(msg.id, msg.content);
                          }
                        }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                      >
                        {msg.role === "user"
                          ? <Pencil size={10} />
                          : (copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />)
                        }
                      </button>
                      {msg.role === "assistant" && !msg.id.startsWith("streaming-") && msg.content && (
                        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          {msg.id === lastAssistantMsgId && (
                            <button
                              onClick={regenerate}
                              title="Regenerate response"
                              className="p-0.5 rounded transition-colors text-muted-foreground hover:text-primary"
                            >
                              <RefreshCw size={9} />
                            </button>
                          )}
                          <button
                            onClick={() => sendFeedback(msg, 1)}
                            title="Good response"
                            className={`p-0.5 rounded transition-colors ${feedbackGiven[msg.id] === 1 ? "text-emerald-400" : "text-muted-foreground hover:text-emerald-400"}`}
                          >
                            <ThumbsUp size={9} />
                          </button>
                          <button
                            onClick={() => sendFeedback(msg, -1)}
                            title="Bad response"
                            className={`p-0.5 rounded transition-colors ${feedbackGiven[msg.id] === -1 ? "text-red-400" : "text-muted-foreground hover:text-red-400"}`}
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

      {/* Quick prompts + mode-aware skill suggestions */}
      <div className="flex gap-1.5 flex-wrap">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => sendMessage(p)}
            className="text-xs font-mono text-muted-foreground hover:text-primary border border-border/50 hover:border-primary/30 rounded px-2 py-1 transition-all"
          >
            {p}
          </button>
        ))}
        {(MODE_SKILL_SUGGESTIONS[chatMode] ?? MODE_SKILL_SUGGESTIONS.AUTO).map((skill) => (
          <button
            key={skill}
            onClick={() => setInput(skill)}
            className="text-xs font-mono text-primary/50 hover:text-primary border border-primary/20 hover:border-primary/40 rounded px-2 py-1 transition-all"
            title={`Quick-start: ${skill}`}
          >
            ⚡ {skill}
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
              {(["specialist", "crew", "delegate"] as const).map((tab) => (
                <button key={tab} onClick={() => setAgentPanelTab(tab)}
                  className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${agentPanelTab === tab ? "bg-violet-500/20 border-violet-500/40 text-violet-300" : "border-border/40 text-muted-foreground hover:text-foreground"}`}
                >{tab.toUpperCase()}</button>
              ))}
            </div>

            {agentPanelTab === "specialist" ? (
              <>
                {activeSpecialist ? (
                  <div className="flex items-center justify-between px-2 py-1.5 rounded border border-violet-500/30 bg-violet-500/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
                      <span className="text-xs font-mono text-violet-300 truncate">{activeSpecialist.agent_name}</span>
                    </div>
                    <button
                      onClick={async () => {
                        const { data: { user } } = await supabase.auth.getUser();
                        if (!user) return;
                        await supabase.from("mavis_active_agency_specialists").delete().eq("user_id", user.id);
                        setActiveSpecialist(null);
                        toast.success("Specialist deactivated");
                      }}
                      className="text-[10px] font-mono text-muted-foreground hover:text-rose-400 transition-colors shrink-0 ml-2"
                    >deactivate ×</button>
                  </div>
                ) : (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    No specialist active — quick-pick below or{" "}
                    <button onClick={() => navigate("/agency")} className="text-violet-400 hover:underline">browse all 182 →</button>
                  </p>
                )}
                <div className="flex gap-2 flex-wrap">
                  {QUICK_SPECIALISTS.map((s) => {
                    const isActive = activeSpecialist?.agent_id === s.agentId;
                    return (
                      <button key={s.label}
                        onClick={() => activateSpecialistFromPanel(s)}
                        title={s.name}
                        className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${
                          isActive
                            ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                            : "border-border/50 text-muted-foreground hover:text-foreground hover:border-violet-500/30"
                        }`}
                      >{isActive ? `✓ ${s.label}` : s.label}</button>
                    );
                  })}
                </div>
                {!activeSpecialist && (
                  <p className="text-xs font-mono text-muted-foreground">Activating a specialist injects their full expertise into MAVIS and enables AGENT mode.</p>
                )}
              </>
            ) : agentPanelTab === "crew" ? (

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
                    className="flex-1 bg-card border border-border rounded px-2.5 py-1.5 text-xs font-body focus:outline-none focus:border-violet-500/50 placeholder:text-muted-foreground placeholder:text-xs"
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
                    className="px-3 py-1.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300 text-xs font-mono hover:bg-violet-500/20 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                  >
                    {crewRunning ? <><span className="w-2 h-2 rounded-full border border-violet-400 border-t-transparent animate-spin" /> Running</> : <><Cpu size={10} /> Launch Crew</>}
                  </button>
                </div>
                {crewResult && (
                  <div className="border border-border/50 rounded bg-muted/20 p-2 max-h-28 overflow-y-auto">
                    <pre className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed">{crewResult}</pre>
                  </div>
                )}
              </>
            ) : agentPanelTab === "delegate" ? (
              <>
                <p className="text-xs font-mono text-muted-foreground mb-2">Give MAVIS a goal. It will autonomously think, plan, and act until done.</p>
                <div className="flex gap-2">
                  <input value={delegateGoal} onChange={(e) => setDelegateGoal(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && delegateGoal.trim() && !delegateRunning) {
                        setDelegateRunning(true); setDelegateSteps([]); setDelegateResult("");
                        const { data: { session: s } } = await (supabase as any).auth.getSession();
                        if (!s) { setDelegateRunning(false); return; }
                        const { data, error } = await (supabase as any).functions.invoke("mavis-goal-loop", { body: { goal: delegateGoal.trim(), max_iterations: 6 } });
                        if (!error && data) {
                          setDelegateSteps(data.steps ?? []);
                          setDelegateResult(data.final_result ?? "");
                          setChatMessages((prev) => [...prev, { id: `delegate-${Date.now()}`, role: "assistant" as const, content: `**[DELEGATE COMPLETE — ${data.iterations} steps]**\n\n${data.final_result}`, mode: "AGENT", timestamp: new Date() }]);
                        }
                        setDelegateRunning(false);
                      }
                    }}
                    placeholder="e.g. Research top 3 competitors and create tasks for each gap..."
                    className="flex-1 bg-card border border-border rounded px-2.5 py-1.5 text-xs font-body focus:outline-none focus:border-violet-500/50 placeholder:text-muted-foreground placeholder:text-xs"
                  />
                  <button onClick={async () => {
                    if (!delegateGoal.trim() || delegateRunning) return;
                    setDelegateRunning(true); setDelegateSteps([]); setDelegateResult("");
                    const { data: { session: s } } = await (supabase as any).auth.getSession();
                    if (!s) { setDelegateRunning(false); return; }
                    const { data, error } = await (supabase as any).functions.invoke("mavis-goal-loop", { body: { goal: delegateGoal.trim(), max_iterations: 6 } });
                    if (!error && data) {
                      setDelegateSteps(data.steps ?? []);
                      setDelegateResult(data.final_result ?? "");
                      setChatMessages((prev) => [...prev, { id: `delegate-${Date.now()}`, role: "assistant" as const, content: `**[DELEGATE COMPLETE — ${data.iterations} steps]**\n\n${data.final_result}`, mode: "AGENT", timestamp: new Date() }]);
                    }
                    setDelegateRunning(false);
                  }} disabled={delegateRunning || !delegateGoal.trim()}
                    className="px-3 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-mono hover:bg-emerald-500/20 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                  >
                    {delegateRunning ? <><span className="w-2 h-2 rounded-full border border-emerald-400 border-t-transparent animate-spin" /> Running</> : <><Cpu size={10} /> Delegate</>}
                  </button>
                </div>
                {delegateSteps.length > 0 && (
                  <div className="border border-border/50 rounded bg-muted/20 p-2 max-h-36 overflow-y-auto space-y-1.5">
                    {delegateSteps.map((s) => (
                      <div key={s.iteration} className="flex gap-1.5 text-xs font-mono">
                        <span className="text-muted-foreground shrink-0">{s.iteration}.</span>
                        <span className="text-violet-300">[{s.action}]</span>
                        <span className="text-foreground/70 truncate">{s.thought}</span>
                      </div>
                    ))}
                    {delegateResult && (
                      <div className="mt-1 pt-1 border-t border-border/30 text-xs font-mono text-emerald-300">{delegateResult.slice(0, 200)}</div>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice controls */}
      <div className="flex items-center gap-2 justify-end flex-wrap">
        {/* Skill catalog shortcut */}
        <button
          onClick={() => setShowSkillCatalog(true)}
          className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-primary border border-border/50 hover:border-primary/30 rounded px-2 py-0.5 transition-all"
          title="Browse all skills"
        >
          <BookOpen size={10} /> Skills
        </button>
        {/* Response length chips */}
        {(["concise", "normal", "detailed"] as const).map((len, i) => {
          const label = ["S", "M", "L"][i];
          const active = responseLength === len;
          return (
            <button
              key={len}
              onClick={() => setResponseLength(len)}
              title={len.charAt(0).toUpperCase() + len.slice(1)}
              className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
                active
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
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

      {/* Editing pill */}
      {editingMsgId && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs font-mono text-amber-400 border border-amber-900/40 rounded px-2 py-0.5 flex items-center gap-1">
            <Pencil size={9} /> Editing…
          </span>
          <button
            onClick={() => { setEditingMsgId(null); setInput(""); }}
            className="text-xs font-mono text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
          </button>
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
          onPaste={(e) => {
            const items = Array.from(e.clipboardData.items);
            const fileItems = items.filter((i) => i.kind === "file");
            if (fileItems.length) {
              e.preventDefault();
              const files = fileItems.map((i) => i.getAsFile()).filter((f): f is File => f !== null);
              if (files.length) upload(files);
            }
          }}
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
          style={{ maxHeight: "100%" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <FileCode size={13} className="text-primary" />
              <span className="text-xs font-mono text-primary uppercase tracking-widest">Artifact</span>
              {artifactLang !== "text" && (
                <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-1.5 rounded">{artifactLang}</span>
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
            <pre className="text-xs font-mono text-foreground/90 whitespace-pre-wrap leading-relaxed break-words">
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
    <AnimatePresence>
      {realtimeVoiceOpen && (
        <MavisRealtimeVoice
          onClose={() => setRealtimeVoiceOpen(false)}
        />
      )}
    </AnimatePresence>
    <ConfirmDialog
      open={confirmRemoveOrder !== null}
      title="Remove standing order?"
      description={`"${confirmRemoveOrder}" will be removed from your custom directives.`}
      onConfirm={() => {
        if (!confirmRemoveOrder) return;
        removeStandingOrder(confirmRemoveOrder);
        setCustomOrders(getCustomOrders());
        setConfirmRemoveOrder(null);
      }}
      onCancel={() => setConfirmRemoveOrder(null)}
    />
    <SkillCatalogDrawer
      open={showSkillCatalog}
      onClose={() => setShowSkillCatalog(false)}
      onUseSkill={(trigger) => {
        setInput(trigger);
        setTimeout(() => inputRef.current?.focus(), 50);
      }}
    />
    </>
  );
}
