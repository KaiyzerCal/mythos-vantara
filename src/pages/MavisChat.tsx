import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Cpu, Copy, Check, ChevronDown, Zap, Brain, Target, Crown, Flame, Database, Mic, MicOff, Users } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase } from "@/integrations/supabase/client";
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

// ── MAVIS modules ───────────────────────────────────────────
import { buildSystemPromptFromSnapshot } from "@/mavis/buildSystemPrompt";
import { setDefaultHandler, registerActionHandler } from "@/mavis/actionExecutor";
import { streamChatMessage } from "@/mavis/chatService";
import { loadFullAppContext } from "@/mavis/appContextLoader";
import { initSession } from "@/mavis/memoryEngine";
import { loadRuntimeSkills } from "@/mavis/skills/_registry";
import type { ExecutionResult } from "@/mavis/types";
// Trigger skill self-registration
import "@/mavis/skills/_loader";

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
  const navigate = useNavigate();
  const {
    profile, quests, tasks, skills, journalEntries, vaultEntries,
    chatMessages, setChatMessages, conversationId, setConversationId,
    chatMode, setChatMode, refetchAll,
    rituals, councils, energySystems, inventory, allies, bpmSessions, storeItems, transformations,
  } = useAppData();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<ExecutionResult[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showModes, setShowModes] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_BY_GENDER.female);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const recognitionRef = useRef<any>(null);

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
    if (!ttsEnabled) return;
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
  }, [ttsEnabled, voiceId, speak, chatMessages]);

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
      await persistMessage({ role: "user", content, mode: chatMode }, convoId);
    }

    const history = chatMessages
      .filter((m) => m.id !== "init")
      .slice(-18)
      .map((m) => ({ role: m.role, content: m.content }));

    // Load full app context fresh from Supabase — ensures AI always sees latest data
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const userId = authSession?.user?.id;

    // Load archived memories and vault media in parallel with full app context
    const [fullCtx, memoriesRes, vaultMediaRes] = await Promise.all([
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

    try {
      // Use fresh Supabase context if available, else fall back to useAppData() data
      const systemPrompt = await (fullCtx
        ? buildSystemPromptFromSnapshot(chatMode, fullCtx, archivedMemories, vaultMedia)
        : buildSystemPromptFromSnapshot(chatMode, {
            profile: profile as any,
            quests: quests as any[], tasks: tasks as any[], skills: skills as any[],
            rankings: [], transformations: transformations as any[],
            journalEntries: journalEntries as any[], vaultEntries: vaultEntries as any[],
            councilMembers: councils as any[], inventory: inventory as any[],
            storeItems: storeItems as any[], energySystems: energySystems as any[],
            bpmSessions: bpmSessions as any[], allies: allies as any[],
            rituals: rituals as any[], pendingApprovals: [], loadedAt: new Date().toISOString(),
          }, archivedMemories, vaultMedia));
      const attachmentIds = attachments.map((a) => a.id);

      // Add a streaming placeholder bubble so the user sees tokens as they arrive
      const streamingId = `streaming-${Date.now()}`;
      setChatMessages((prev) => [...prev, {
        id: streamingId,
        role: "assistant" as const,
        content: "",
        mode: chatMode,
        timestamp: new Date(),
      }]);

      const { cleanText, executionResults, conversationId: newConvoId, searched, imageUrl, fnData } = await streamChatMessage(
        content,
        systemPrompt,
        history,
        {
          mode: chatMode,
          conversationId,
          appState: compactState,
          chatKind: "mavis",
          threadRef: "main",
          attachmentIds,
        },
        (_token, accumulated) => {
          if (cancelledRef.current) return;
          setChatMessages((prev) => prev.map((m) =>
            m.id === streamingId ? { ...m, content: accumulated } : m
          ));
        },
      );

      if (cancelledRef.current) {
        setChatMessages((prev) => prev.filter((m) => m.id !== streamingId));
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
      const assistantMsg = {
        id: `a-${Date.now()}`,
        role: "assistant" as const,
        content: cleanText,
        mode: chatMode,
        model: (fnData as any)?.model ?? null,
        searched,
        actionsExecuted,
        imageUrl: imageUrl ?? undefined,
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
      if (cancelledRef.current) return;
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
      abortRef.current = null;
    }
  }, [input, chatMessages, isLoading, chatMode, profile, quests, tasks, skills, journalEntries, vaultEntries, conversationId, setChatMessages, setConversationId, refetchAll, ensureConversation, persistMessage, saveMemoriesFromResponse, speakText, attachments]);

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
    <div className="flex flex-col h-[calc(100dvh-4rem)] gap-2 pb-0">
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
                            <div className="flex items-center gap-1 py-1 px-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "0ms" }} />
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "160ms" }} />
                              <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: "320ms" }} />
                            </div>
                          ) : (
                            <div className="mavis-prose">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
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
                      <button
                        onClick={() => copyMessage(msg.id, msg.content)}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                      >
                        {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                      </button>
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
  );
}
