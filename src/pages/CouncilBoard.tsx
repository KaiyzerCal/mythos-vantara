import { useState, useRef, useEffect, useCallback } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, ArrowLeft, Users, Database, Square, Mic, MicOff, Zap, ChevronDown, ChevronUp, PhoneCall, MessageSquare, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadFullAppContext, type AppContextSnapshot } from "@/mavis/appContextLoader";
import {
  sendCouncilMessage,
  type CouncilBoardMessage,
} from "@/mavis/councilBoardService";
import type { CouncilMember } from "@/mavis/councilPersona";
import { buildCouncilMemberPrompt, buildCouncilMemberVoicePrompt, buildPersonaVoiceSystemPrompt, buildContextSummary } from "@/mavis/councilPersona";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";
import type { VoicePersona } from "@/components/VoiceChatOverlay";
import { CouncilGroupVoice } from "@/components/CouncilGroupVoice";
import type { UnifiedPersona } from "@/mavis/agentTypes";
import { loadPersonaAgents } from "@/mavis/agentLoader";
import { parseProposedActions, submitProposalsForApproval } from "@/mavis/proposeAction";
import { ScrollProgressBar, BackToTopButton, ScrollToBottomButton, EndOfFeed } from "@/components/chat/ScrollKit";
import { AttachmentTray, AttachButton } from "@/components/chat/AttachmentTray";
import { CopyButton } from "@/components/chat/CopyButton";
import { useChatAttachments } from "@/hooks/useChatAttachments";
import { toast } from "sonner";

// ── Speaker styling ───────────────────────────────────────────────────────
const MEMBER_COLORS = [
  { border: "border-blue-500/40",   badge: "bg-blue-600",   label: "text-blue-400"   },
  { border: "border-green-500/40",  badge: "bg-green-600",  label: "text-green-400"  },
  { border: "border-orange-500/40", badge: "bg-orange-600", label: "text-orange-400" },
  { border: "border-pink-500/40",   badge: "bg-pink-600",   label: "text-pink-400"   },
  { border: "border-cyan-500/40",   badge: "bg-cyan-600",   label: "text-cyan-400"   },
  { border: "border-rose-500/40",   badge: "bg-rose-600",   label: "text-rose-400"   },
];

const PERSONA_COLORS = [
  { border: "border-amber-500/40",   badge: "bg-amber-600",   label: "text-amber-400"   },
  { border: "border-yellow-500/40",  badge: "bg-yellow-600",  label: "text-yellow-400"  },
  { border: "border-lime-500/40",    badge: "bg-lime-600",    label: "text-lime-400"    },
  { border: "border-emerald-500/40", badge: "bg-emerald-600", label: "text-emerald-400" },
];

function speakerStyle(speakerId: string, isUser: boolean, speakerType?: string) {
  if (isUser)         return { border: "border-primary/30",    badge: "bg-primary/80",  label: "text-primary"    };
  if (speakerId === "mavis") return { border: "border-purple-500/40", badge: "bg-purple-700", label: "text-purple-300" };
  if (speakerId === "system") return { border: "border-gray-500/30", badge: "bg-gray-600",  label: "text-gray-400"   };

  if (speakerType === "persona") {
    const hash = speakerId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return PERSONA_COLORS[hash % PERSONA_COLORS.length];
  }

  const hash = speakerId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return MEMBER_COLORS[hash % MEMBER_COLORS.length];
}

const makeId = () => crypto.randomUUID();
const THREAD_REF = "council-board";

export default function CouncilBoard() {
  const navigate = useNavigate();
  const [messages,         setMessages]         = useState<CouncilBoardMessage[]>([]);
  const [input,            setInput]            = useState("");
  const [loading,          setLoading]          = useState(false);
  const [councilMembers,   setCouncilMembers]   = useState<CouncilMember[]>([]);
  const [personas,         setPersonas]         = useState<UnifiedPersona[]>([]);
  const [summonedIds,      setSummonedIds]      = useState<string[]>([]);
  const [showPersonaPanel, setShowPersonaPanel] = useState(false);
  const [userId,           setUserId]           = useState<string | null>(null);
  const [conversationId,   setConversationId]   = useState<string | null>(null);
  const [isComposing,      setIsComposing]      = useState(false);
  const [isSyncing,        setIsSyncing]        = useState(false);
  const [showScrollBtn,    setShowScrollBtn]    = useState(false);
  const [scrollProgress,   setScrollProgress]   = useState(0);
  const [showBackToTop,    setShowBackToTop]    = useState(false);
  const [isListening,      setIsListening]      = useState(false);
  const [voiceTarget,      setVoiceTarget]      = useState<VoicePersona | null>(null);
  const [appCtx,           setAppCtx]           = useState<AppContextSnapshot | null>(null);
  const [groupVoiceOpen,   setGroupVoiceOpen]   = useState(false);
  const [confirmClear,     setConfirmClear]     = useState(false);
  // ── Discourse mode (MoltBook-style structured AI debate) ──────────────
  const [discourseOpen,    setDiscourseOpen]    = useState(false);
  const [discourseTopic,   setDiscourseTopic]   = useState("");
  const [discourseRunning, setDiscourseRunning] = useState(false);
  const [discourseResult,  setDiscourseResult]  = useState<{
    id?: string; topic: string;
    rounds: Array<{ speaker_name: string; speaker_role: string; content: string; stage: string }>;
    synthesis: string;
  } | null>(null);

  // ── Realtime streaming state ──────────────────────────────────────
  // Keyed by `${speakerId}:${round}` so Round 1 and deliberation cards coexist.
  const [memberResponses, setMemberResponses] = useState<Record<string, {
    speakerName: string;
    speakerRole: string;
    speakerType: "council" | "persona";
    response: string;
    error?: string;
    loading: boolean;
    summoned?: boolean;
    timestamp: number;
    deliberationRound?: number;
  }>>({});

  const cancelledRef      = useRef(false);
  const sessionIdRef      = useRef<string | null>(null);
  const scrollRef         = useRef<HTMLDivElement>(null);
  const bottomRef         = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLTextAreaElement>(null);
  const recognitionRef    = useRef<any>(null);

  const { attachments, isUploading, upload, remove } = useChatAttachments("council", THREAD_REF);

  // ── Load user, members, personas, and persisted thread ───────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { toast.error("Not authenticated"); return; }
      const uid = session.user.id;
      setUserId(uid);

      // Load council members
      try {
        const { data: members } = await supabase
          .from("councils").select("*").eq("user_id", uid).order("name");
        setCouncilMembers((members ?? []) as CouncilMember[]);
      } catch { toast.error("Failed to load council members"); }

      // Load personas (for summon panel)
      try {
        const plist = await loadPersonaAgents(uid);
        setPersonas(plist.filter(p => p.canJoinCouncil));
      } catch { /* non-fatal */ }

      // Restore most recent council-board conversation
      try {
        const { data: convos } = await supabase
          .from("chat_conversations")
          .select("id, title")
          .eq("user_id", uid)
          .ilike("title", "Council Board%")
          .order("updated_at", { ascending: false })
          .limit(1);
        if (!convos?.length) return;
        const cid = convos[0].id;
        setConversationId(cid);
        const { data: msgs } = await supabase
          .from("chat_messages")
          .select("*").eq("conversation_id", cid)
          .order("created_at", { ascending: true }).limit(400);
        if (msgs?.length) {
          const restored: CouncilBoardMessage[] = msgs.map((m: any) => {
            const parts   = (m.mode ?? "").split("|");
            const isUser  = m.role === "user";
            return {
              id:          m.id,
              speakerId:   isUser ? "user" : (parts[0] || "mavis"),
              speakerName: isUser ? "Sovereign" : (parts[1] || "MAVIS"),
              speakerRole: isUser ? "You" : (parts[2] || "Supreme Intelligence"),
              speakerType: isUser ? "user" : (parts[3] || "mavis") as any,
              content:     m.content,
              timestamp:   new Date(m.created_at).getTime(),
              isUser,
            };
          });
          setMessages(restored);
        }
      } catch (err) {
        console.error("[CouncilBoard] restore failed:", err);
      }
    })();
  }, []);

  // Pre-load app context so voice calls have full user state in system prompt
  useEffect(() => {
    if (!userId) return;
    loadFullAppContext(userId).then(setAppCtx).catch(() => {/* non-fatal */});
  }, [userId]);

  const ensureConversation = useCallback(async (uid: string): Promise<string | null> => {
    if (conversationId) return conversationId;
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ user_id: uid, title: `Council Board — ${new Date().toLocaleDateString()}` })
      .select("id").single();
    if (error) { console.error(error); return null; }
    setConversationId(data.id);
    return data.id;
  }, [conversationId]);

  const persist = useCallback(async (cid: string, uid: string, m: CouncilBoardMessage) => {
    try {
      await supabase.from("chat_messages").insert({
        id: m.id,
        conversation_id: cid, user_id: uid,
        role:    m.isUser ? "user" : "assistant",
        content: m.content,
        // Encode: speakerId|speakerName|speakerRole|speakerType
        mode: m.isUser ? "USER" : `${m.speakerId}|${m.speakerName}|${m.speakerRole}|${m.speakerType ?? "council"}`,
      });
    } catch (err) { console.error(err); }
  }, []);

  const scrollToBottom = useCallback(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, []);
  const scrollToTop    = useCallback(() => { scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, []);
  const handleScroll   = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const scrollable = scrollHeight - clientHeight;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120);
    setScrollProgress(scrollable > 0 ? Math.round((scrollTop / scrollable) * 100) : 100);
    setShowBackToTop(scrollTop > 200);
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, memberResponses, scrollToBottom]);

  // ── Postgres changes subscription — picks up Telegram-originated messages ──
  // Whenever the Telegram /council command writes to this conversation's
  // chat_messages, this subscription surfaces them live in the board UI.
  useEffect(() => {
    if (!conversationId) return;
    const channel = (supabase as any)
      .channel(`council-pg-${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` }, (payload: any) => {
        const row = payload.new;
        if (!row) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev;
          const parts = (row.mode ?? "").split("|");
          const isUser = row.role === "user";
          const msg: CouncilBoardMessage = {
            id:          row.id,
            speakerId:   isUser ? "user" : (parts[0] || "mavis"),
            speakerName: isUser ? "Sovereign" : (parts[1] || "MAVIS"),
            speakerRole: isUser ? "You" : (parts[2] || "Council"),
            speakerType: isUser ? "user" as any : (parts[3] || "council") as any,
            content:     row.content,
            timestamp:   new Date(row.created_at).getTime(),
            isUser,
          };
          return [...prev, msg];
        });
      })
      .subscribe();
    return () => { (supabase as any).removeChannel(channel); };
  }, [conversationId]);

  // ── Realtime channel subscription ────────────────────────────────────
  // Subscribes to `council:{sessionId}` so member responses stream in as they
  // resolve. Handles both "member_response" (Round 1) and "deliberation_response"
  // (deliberation rounds) events — both use the same card format but are
  // shown with a round badge so the user sees the discourse unfolding.
  useEffect(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;

    const handleBroadcast = ({ payload }: { payload: any }) => {
      if (!payload?.speakerId) return;
      const round = payload.round ?? 1;
      // Use a compound key so Round 1 and deliberation cards coexist
      const key = `${payload.speakerId}:${round}`;
      setMemberResponses(prev => ({
        ...prev,
        [key]: {
          speakerName:        payload.memberName,
          speakerRole:        payload.speakerRole,
          speakerType:        payload.speakerType,
          response:           payload.response ?? "",
          error:              payload.error,
          loading:            false,
          summoned:           payload.summoned,
          timestamp:          payload.timestamp ?? Date.now(),
          deliberationRound:  round,
        },
      }));
    };

    const channel = supabase
      .channel(`council:${sid}`)
      .on("broadcast", { event: "member_response" },     handleBroadcast)
      .on("broadcast", { event: "deliberation_response" }, handleBroadcast)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Summon / un-summon persona ────────────────────────────────────
  const handleSummon = useCallback((persona: UnifiedPersona) => {
    setSummonedIds(prev => {
      if (prev.includes(persona.id)) return prev;
      const updated = [...prev, persona.id];
      toast.success(`⚡ ${persona.name} has entered the council chamber`);
      setMessages(m => [...m, {
        id:          makeId(),
        speakerId:   "system",
        speakerName: "Council",
        speakerRole: "System",
        speakerType: "mavis",
        content:     `${persona.name} has been summoned into the session.`,
        timestamp:   Date.now(),
        isUser:      false,
        summoned:    true,
      }]);
      return updated;
    });
  }, []);

  const handleUnsummon = useCallback((personaId: string) => {
    setSummonedIds(prev => prev.filter(id => id !== personaId));
  }, []);

  // ── Speech-to-text ─────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Speech recognition not supported"); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    let finalT = "";
    r.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalT += t + " "; else interim = t;
      }
      setInput(finalT + interim);
    };
    r.onend = () => setIsListening(false);
    r.onerror = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
    setIsListening(true);
  }, []);
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  // ── OmniSync ──────────────────────────────────────────────────────
  const handleOmniSync = useCallback(async () => {
    if (isSyncing || !userId) return;
    setIsSyncing(true);
    try {
      const condensed = messages
        .map(m => `[${m.speakerName}] ${m.content.slice(0, 250)}${m.content.length > 250 ? "…" : ""}`)
        .join("\n");
      const summary = `Council Board OmniSync | ${councilMembers.length} members | ${messages.length} msgs`;
      const { error } = await supabase.from("omnisync_snapshots").insert({
        user_id: userId,
        snapshot_data: { kind: "council-board", message_count: messages.length, members: councilMembers.map(m => m.name) },
        condensed_comms: condensed.slice(0, 10000),
        summary,
      });
      if (error) throw error;
      toast.success("OmniSync complete — council session snapshot saved");
    } catch (e: any) {
      toast.error("OmniSync failed: " + (e?.message ?? "unknown"));
    } finally { setIsSyncing(false); }
  }, [isSyncing, userId, messages, councilMembers]);

  // ── Discourse mode ────────────────────────────────────────────────
  // MoltBook-style: positions → challenges → MAVIS synthesis
  const handleDiscourse = useCallback(async () => {
    if (!discourseTopic.trim() || !userId || discourseRunning) return;
    if (councilMembers.length + summonedIds.length === 0) {
      toast.error("Summon council members or personas before starting a discourse.");
      return;
    }
    setDiscourseRunning(true);
    setDiscourseResult(null);
    try {
      const summonedPersonas = personas.filter(p => summonedIds.includes(p.id));
      const participants = [
        ...councilMembers.map(m => ({ id: m.id, name: m.name, role: m.role, specialty: m.specialty, notes: m.notes, speakerType: "council" as const })),
        ...summonedPersonas.map(p => ({ id: p.id, name: p.name, role: p.role, bio: (p as any).bio, adjectives: (p as any).adjectives, topics: (p as any).topics, speakerType: "persona" as const })),
      ];

      const res = await supabase.functions.invoke("mavis-discourse-runner", {
        body: { user_id: userId, topic: discourseTopic.trim(), participants },
      });

      if (res.error) throw new Error(res.error.message ?? "Discourse failed");
      setDiscourseResult(res.data);

      // Post synthesis as a message in the board thread
      const cid = await ensureConversation(userId);
      const synthMsg: CouncilBoardMessage = {
        id:          makeId(),
        speakerId:   "mavis",
        speakerName: "MAVIS",
        speakerRole: "Discourse Synthesis",
        speakerType: "mavis",
        content:     `**Discourse: ${discourseTopic.trim()}**\n\n${res.data.synthesis}`,
        timestamp:   Date.now(),
        isUser:      false,
      };
      setMessages(prev => [...prev, synthMsg]);
      if (cid) await persist(cid, userId, synthMsg);
      setDiscourseOpen(false);
      setDiscourseTopic("");
      toast.success("Discourse complete — synthesis added to thread");
    } catch (e: any) {
      toast.error("Discourse error: " + (e?.message ?? "unknown"));
    } finally {
      setDiscourseRunning(false);
    }
  }, [discourseTopic, userId, discourseRunning, councilMembers, personas, summonedIds, ensureConversation, persist]);

  // ── Clear: archive then wipe ──────────────────────────────────────
  const handleClear = useCallback(async () => {
    if (!userId) return;
    try {
      await handleOmniSync();
      if (messages.length > 0) {
        const fullThread = messages
          .map(m => `[${m.speakerName} — ${m.speakerRole}] ${m.content}`).join("\n\n");
        await supabase.from("memories").insert({
          user_id:     userId,
          title:       `Council Board — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
          content:     fullThread.slice(0, 50000),
          memory_type: "conversation",
          source:      "council_chat_clear",
          tags:        ["council-board", "archived"],
          metadata:    { message_count: messages.length, cleared_at: new Date().toISOString() },
        });
      }
      if (conversationId) {
        await supabase.from("chat_messages").delete().eq("conversation_id", conversationId).eq("user_id", userId);
        await supabase.from("chat_conversations").delete().eq("id", conversationId).eq("user_id", userId);
      }
      setMessages([]);
      setConversationId(null);
      setSummonedIds([]);
      toast.success("Thread archived — memories preserved");
    } catch (e: any) {
      toast.error("Clear failed: " + (e?.message ?? "unknown"));
    }
  }, [userId, messages, conversationId, handleOmniSync]);

  // ── Send ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || loading || !userId) return;
    const text = input.trim();
    setInput("");
    setLoading(true);
    cancelledRef.current = false;

    // Generate a fresh session ID for this deliberation round and
    // initialise all active members/personas as loading so their cards
    // appear immediately with a spinner before their responses arrive.
    const newSessionId = crypto.randomUUID();
    sessionIdRef.current = newSessionId;

    const summonedPersonas = personas.filter(p => summonedIds.includes(p.id));
    const initialLoading: typeof memberResponses = {};
    for (const m of councilMembers) {
      initialLoading[m.id] = {
        speakerName: m.name,
        speakerRole: m.role ?? "Council Member",
        speakerType: "council",
        response:    "",
        loading:     true,
        timestamp:   Date.now(),
      };
    }
    for (const p of summonedPersonas) {
      initialLoading[p.id] = {
        speakerName: p.name,
        speakerRole: p.role ?? "Persona",
        speakerType: "persona",
        response:    "",
        loading:     true,
        summoned:    true,
        timestamp:   Date.now(),
      };
    }
    setMemberResponses(initialLoading);

    const cid = await ensureConversation(userId);

    const userMsg: CouncilBoardMessage = {
      id: makeId(), speakerId: "user", speakerName: "Sovereign",
      speakerRole: "You", speakerType: "user", content: text, timestamp: Date.now(), isUser: true,
    };
    setMessages(prev => [...prev, userMsg]);
    if (cid) await persist(cid, userId, userMsg);

    try {
      const appContext = await loadFullAppContext(userId);

      const result = await sendCouncilMessage(
        text,
        messages,
        councilMembers,
        appContext,
        { summonedPersonas, sessionId: newSessionId },
      );
      if (cancelledRef.current) return;

      const newMsgs: CouncilBoardMessage[] = [];

      // MAVIS reply
      const mavis = parseProposedActions(result.mavisResponse);
      if (mavis.proposals.length > 0) {
        const n = await submitProposalsForApproval(userId, "MAVIS", mavis.proposals);
        if (n > 0) toast.success(`MAVIS proposed ${n} action${n > 1 ? "s" : ""} — awaiting approval`);
      }
      newMsgs.push({
        id: makeId(), speakerId: "mavis", speakerName: "MAVIS",
        speakerRole: "Supreme Intelligence", speakerType: "mavis",
        content: mavis.cleanText || result.mavisResponse,
        timestamp: Date.now(), isUser: false,
      });

      // Council member replies
      for (const r of result.memberResponses) {
        const parsed = parseProposedActions(r.response);
        if (parsed.proposals.length > 0) {
          const n = await submitProposalsForApproval(userId, r.member.name, parsed.proposals);
          if (n > 0) toast.success(`${r.member.name} proposed ${n} action${n > 1 ? "s" : ""} — awaiting approval`);
        }
        newMsgs.push({
          id: makeId(), speakerId: r.member.id, speakerName: r.member.name,
          speakerRole: r.member.role ?? "Council Member", speakerType: "council",
          content: parsed.cleanText || r.response,
          timestamp: Date.now(), isUser: false,
        });
      }

      // Persona replies (Round 1)
      for (const r of (result.personaResponses ?? [])) {
        const parsed = parseProposedActions(r.response);
        newMsgs.push({
          id: makeId(), speakerId: r.persona.id, speakerName: r.persona.name,
          speakerRole: r.persona.role ?? "Persona", speakerType: "persona",
          content: parsed.cleanText || r.response,
          timestamp: Date.now(), isUser: false,
          summoned: r.summoned,
          deliberationRound: 1,
        });
      }

      // Deliberation rounds — members responding to each other
      for (const dRound of (result.deliberationRounds ?? [])) {
        // Visual separator
        newMsgs.push({
          id: makeId(), speakerId: "system",
          speakerName: `Deliberation — Round ${dRound.round}`,
          speakerRole: "Council continues", speakerType: "mavis",
          content: "The council deliberates — members respond to each other.",
          timestamp: Date.now(), isUser: false,
          deliberationRound: dRound.round,
        });

        for (const r of dRound.memberResponses) {
          const parsed = parseProposedActions(r.response);
          if (parsed.proposals.length > 0) {
            const n = await submitProposalsForApproval(userId, r.member.name, parsed.proposals);
            if (n > 0) toast.success(`${r.member.name} proposed ${n} action${n > 1 ? "s" : ""}`);
          }
          newMsgs.push({
            id: makeId(), speakerId: r.member.id, speakerName: r.member.name,
            speakerRole: r.member.role ?? "Council Member", speakerType: "council",
            content: parsed.cleanText || r.response,
            timestamp: Date.now(), isUser: false,
            deliberationRound: dRound.round,
          });
        }

        for (const r of dRound.personaResponses) {
          const parsed = parseProposedActions(r.response);
          newMsgs.push({
            id: makeId(), speakerId: r.persona.id, speakerName: r.persona.name,
            speakerRole: r.persona.role ?? "Persona", speakerType: "persona",
            content: parsed.cleanText || r.response,
            timestamp: Date.now(), isUser: false,
            summoned: r.summoned,
            deliberationRound: dRound.round,
          });
        }
      }

      setMessages(prev => [...prev, ...newMsgs]);
      if (cid) for (const m of newMsgs) await persist(cid, userId, m);
      // Clear streamed loading cards — the final messages now replace them
      setMemberResponses({});
      sessionIdRef.current = null;
    } catch (err: any) {
      if (cancelledRef.current) return;
      console.error(err);
      toast.error("Council session error — " + (err?.message ?? "unknown"));
      setMemberResponses({});
      sessionIdRef.current = null;
      setMessages(prev => [...prev, {
        id: makeId(), speakerId: "system", speakerName: "System", speakerRole: "Error",
        speakerType: "mavis",
        content: "The council session encountered an error. Please try again.",
        timestamp: Date.now(), isUser: false,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, userId, messages, councilMembers, personas, summonedIds, ensureConversation, persist]);

  const activeSummonedPersonas = personas.filter(p => summonedIds.includes(p.id));
  const availablePersonas      = personas.filter(p => !summonedIds.includes(p.id));

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] gap-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/50 flex-wrap">
        <button onClick={() => navigate("/mavis")} className="text-muted-foreground hover:text-primary transition-colors" title="Back to MAVIS">
          <ArrowLeft size={16} />
        </button>
        <Users size={16} className="text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-mono font-bold text-primary">Council Board</h1>
          <p className="text-xs font-mono text-muted-foreground truncate">
            {councilMembers.length} member{councilMembers.length !== 1 ? "s" : ""}
            {activeSummonedPersonas.length > 0 && ` · ${activeSummonedPersonas.length} persona${activeSummonedPersonas.length > 1 ? "s" : ""} summoned`}
            {" · MAVIS presiding"}
          </p>
          {/* Per-member 1-on-1 voice call — dropdown */}
          {councilMembers.length > 0 && (
            <div className="relative mt-1.5 inline-flex items-center gap-1 group">
              <PhoneCall size={10} className="text-emerald-400/70 shrink-0" />
              <select
                defaultValue=""
                onChange={(e) => {
                  const member = councilMembers.find(m => m.id === e.target.value);
                  if (!member) return;
                  e.target.value = "";
                  setVoiceTarget({
                    name: member.name,
                    role: member.role ?? member.specialty,
                    systemPrompt: buildCouncilMemberVoicePrompt(member, appCtx ? buildContextSummary(appCtx) : ""),
                    entityId: member.id,
                    entityType: "council",
                    userId: userId ?? undefined,
                    avatarUrl: member.avatar ?? undefined,
                  });
                }}
                className="appearance-none text-xs font-mono font-medium text-emerald-400 bg-emerald-950/30 hover:bg-emerald-950/50 border border-emerald-800/40 hover:border-emerald-500/50 rounded-md pl-2 pr-6 py-1 transition-all cursor-pointer focus:outline-none focus:border-emerald-500/60"
              >
                <option value="" disabled className="text-muted-foreground bg-card">Call a member…</option>
                {councilMembers.map((m) => (
                  <option key={m.id} value={m.id} className="bg-card text-foreground">
                    {m.name}{m.role ? ` — ${m.role}` : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-1.5 text-emerald-400/60 pointer-events-none" />
            </div>
          )}
          {/* Group voice call — all members at once */}
          {councilMembers.length > 1 && (
            <button
              onClick={() => setGroupVoiceOpen(true)}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-mono font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 border border-primary/30 hover:border-primary/50 rounded-md px-2 py-1 transition-all"
            >
              <Users size={10} />
              Group Call
            </button>
          )}
        </div>
        {/* Persona summon toggle */}
        {personas.length > 0 && (
          <button
            onClick={() => setShowPersonaPanel(v => !v)}
            className="flex items-center gap-1 text-xs font-mono text-amber-400 hover:text-amber-300 border border-amber-900/40 hover:border-amber-400/40 rounded px-2 py-1 transition-all"
            title="Summon personas"
          >
            <Zap size={10} />
            Summon
            {showPersonaPanel ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
        <button
          onClick={() => setDiscourseOpen(v => !v)}
          className={`flex items-center gap-1 text-xs font-mono border rounded px-2 py-1 transition-all ${discourseOpen ? "text-violet-300 border-violet-500/50 bg-violet-900/20" : "text-violet-400 hover:text-violet-300 border-violet-900/40 hover:border-violet-400/40"}`}
          title="Start structured discourse"
        >
          <MessageSquare size={10} /> Discourse
        </button>
        <button
          onClick={handleOmniSync}
          disabled={isSyncing}
          className="flex items-center gap-1 text-xs font-mono text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 hover:border-cyan-400/40 rounded px-2 py-1 transition-all disabled:opacity-40"
        >
          <Database size={10} /> OmniSync
        </button>
        <button
          onClick={() => setConfirmClear(true)}
          className="text-xs font-mono text-muted-foreground hover:text-destructive border border-border hover:border-destructive/40 rounded px-2 py-1 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Persona summon panel */}
      <AnimatePresence>
        {showPersonaPanel && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border bg-amber-950/10"
          >
            <div className="px-4 py-2 space-y-1.5">
              <p className="text-xs font-mono text-amber-400/70 uppercase tracking-wider">Summon into session</p>
              <div className="flex flex-wrap gap-1.5">
                {availablePersonas.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSummon(p)}
                    className="flex items-center gap-1 text-xs font-mono text-amber-300 border border-amber-700/40 bg-amber-900/20 hover:bg-amber-800/30 hover:border-amber-500/50 rounded px-2 py-1 transition-all"
                  >
                    <Zap size={8} /> {p.name}
                    {p.role && <span className="text-amber-500/60 ml-0.5">· {p.role}</span>}
                  </button>
                ))}
                {availablePersonas.length === 0 && (
                  <span className="text-xs font-mono text-muted-foreground">All personas are in session.</span>
                )}
              </div>
              {activeSummonedPersonas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-amber-900/30">
                  <span className="text-xs font-mono text-amber-500/50 self-center">In session:</span>
                  {activeSummonedPersonas.map(p => (
                    <div key={p.id} className="flex items-center gap-0.5">
                      <button
                        onClick={() => handleUnsummon(p.id)}
                        className="flex items-center gap-1 text-xs font-mono text-amber-200 border border-amber-500/40 bg-amber-800/30 hover:bg-red-900/30 hover:border-red-500/40 hover:text-red-300 rounded-l px-2 py-1 transition-all"
                        title="Remove from session"
                      >
                        {p.name} ×
                      </button>
                      <button
                        onClick={() => setVoiceTarget({ name: p.name, role: p.role, systemPrompt: buildPersonaVoiceSystemPrompt({ name: p.name, role: p.role, archetype: p.archetype, system_prompt: p.systemPrompt, agent_folders: (p as any).agent_folders ?? null }), entityId: p.id, entityType: "persona", userId: userId ?? undefined, avatarUrl: (p as any).avatar_key ?? undefined })}
                        className="flex items-center px-1.5 py-1 text-amber-400 border border-amber-500/40 bg-amber-800/30 hover:bg-amber-700/40 hover:text-amber-200 rounded-r border-l-0 transition-all"
                        title={`Voice call ${p.name}`}
                      >
                        <PhoneCall size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Discourse panel (MoltBook-style) ────────────────────────── */}
      <AnimatePresence>
        {discourseOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-violet-900/40 bg-violet-950/10"
          >
            <div className="px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-violet-400 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare size={10} /> Structured Discourse
                </p>
                <span className="text-xs font-mono text-muted-foreground">
                  {councilMembers.length + summonedIds.length} participant{(councilMembers.length + summonedIds.length) !== 1 ? "s" : ""}
                  {" · positions → challenges → MAVIS synthesis"}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  value={discourseTopic}
                  onChange={e => setDiscourseTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleDiscourse(); } }}
                  placeholder='Topic to debate, e.g. "Should we pivot to B2B?" or "What is the biggest risk to our Q3 goal?"'
                  className="flex-1 bg-muted/30 border border-violet-800/40 focus:border-violet-500/60 rounded px-3 py-2 text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
                />
                <button
                  onClick={handleDiscourse}
                  disabled={discourseRunning || !discourseTopic.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded border border-violet-500/40 bg-violet-900/30 text-violet-300 text-xs font-mono hover:bg-violet-800/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {discourseRunning ? (
                    <><Loader2 size={11} className="animate-spin" /> Running…</>
                  ) : (
                    <><MessageSquare size={11} /> Start Discourse</>
                  )}
                </button>
              </div>
              {discourseRunning && (
                <p className="text-xs font-mono text-violet-400/60 animate-pulse">
                  Stage 1/3: Gathering positions… Stage 2/3: Challenge round… Stage 3/3: MAVIS synthesis…
                </p>
              )}
              {discourseResult && (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  <p className="text-xs font-mono text-violet-400 uppercase tracking-wider">
                    Last discourse: {discourseResult.topic}
                  </p>
                  {discourseResult.rounds.filter(r => r.stage !== "synthesis").map((r, i) => (
                    <div key={i} className={`text-xs font-body rounded px-2.5 py-1.5 border ${r.stage === "challenge" ? "border-orange-900/30 bg-orange-950/10 text-orange-200/80" : "border-violet-900/30 bg-violet-950/10 text-violet-200/80"}`}>
                      <span className="font-mono text-[10px] uppercase tracking-wider opacity-60 mr-1">[{r.speaker_name} · {r.stage}]</span>
                      {r.content.slice(0, 200)}{r.content.length > 200 ? "…" : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <ScrollProgressBar progress={scrollProgress} />
        <BackToTopButton visible={showBackToTop} onClick={scrollToTop} />
        <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
              <Users size={32} className="text-muted-foreground" />
              <p className="text-sm font-mono text-muted-foreground">The council awaits your address.</p>
              <p className="text-xs font-mono text-muted-foreground">
                MAVIS responds first — council members weigh in based on relevance.
              </p>
              {personas.length > 0 && (
                <p className="text-xs font-mono text-amber-500/50">
                  {personas.length} persona{personas.length !== 1 ? "s" : ""} available to summon via ⚡
                </p>
              )}
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map(msg => {
              const style = speakerStyle(msg.speakerId, msg.isUser, msg.speakerType);
              const isDelibSeparator = msg.speakerId === "system" && (msg.deliberationRound ?? 0) >= 2;

              // Deliberation round separator — full-width divider
              if (isDelibSeparator) {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-3 py-2"
                  >
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded border border-border bg-card/60 whitespace-nowrap">
                      ⟳ {msg.speakerName}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </motion.div>
                );
              }

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`border-l-2 ${style.border} pl-3 py-1.5`}
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded text-white ${style.badge}`}>
                      {msg.speakerName}
                    </span>
                    {/* Agent type badge */}
                    {msg.speakerType === "council" && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-700/30">
                        {(msg.deliberationRound ?? 1) >= 2 ? "DELIBERATION" : "COUNCIL"}
                      </span>
                    )}
                    {msg.speakerType === "persona" && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/30">
                        {msg.summoned ? "⚡ SUMMONED" : "PERSONA"}
                      </span>
                    )}
                    <span className={`text-xs font-mono ${style.label}`}>{msg.speakerRole}</span>
                    <span className="text-xs font-mono text-muted-foreground ml-auto">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <CopyButton content={msg.content} />
                  </div>
                  <p className="text-xs font-body text-foreground/90 leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-l-2 border-purple-500/40 pl-3 py-1.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded text-white bg-purple-700">Council</span>
                <span className="text-xs font-mono text-purple-300">deliberating...</span>
              </div>
              <div className="flex gap-1 mt-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </motion.div>
          )}

          {/* Streaming member response cards — shown during deliberation,
              replaced by final messages once sendCouncilMessage resolves */}
          <AnimatePresence>
            {loading && Object.entries(memberResponses).map(([speakerId, state]) => {
              const style = speakerStyle(speakerId, false, state.speakerType);
              return (
                <motion.div
                  key={`streaming-${speakerId}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className={`border-l-2 ${style.border} pl-3 py-1.5`}
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded text-white ${style.badge}`}>
                      {state.speakerName}
                    </span>
                    {state.speakerType === "council" && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-400 border border-purple-700/30">
                        COUNCIL
                      </span>
                    )}
                    {state.speakerType === "persona" && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/30">
                        {state.summoned ? "⚡ SUMMONED" : "PERSONA"}
                      </span>
                    )}
                    <span className={`text-xs font-mono ${style.label}`}>{state.speakerRole}</span>
                    {state.loading && (
                      <span className="flex gap-0.5 ml-auto">
                        {[0, 1, 2].map(i => (
                          <span key={i} className="w-1 h-1 rounded-full bg-current opacity-60 animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
                        ))}
                      </span>
                    )}
                    {!state.loading && (
                      <span className="text-xs font-mono text-muted-foreground ml-auto">
                        {new Date(state.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                  {state.loading ? (
                    <p className="text-xs font-mono text-muted-foreground italic">Thinking...</p>
                  ) : (
                    <p className="text-xs font-body text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {state.error
                        ? <span className="text-destructive/70">[Error: {state.error}]</span>
                        : state.response}
                    </p>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {!loading && messages.length > 0 && <EndOfFeed messageCount={messages.length} />}
          <div ref={bottomRef} />
        </div>
        <ScrollToBottomButton visible={showScrollBtn} onClick={scrollToBottom} />
      </div>

      {/* Attachment tray */}
      {(attachments.length > 0 || isUploading) && (
        <div className="px-3 pt-2">
          <AttachmentTray
            attachments={attachments}
            isUploading={isUploading}
            onUpload={upload}
            onRemove={remove}
            compact
          />
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border px-4 py-3 flex gap-2 bg-card/30 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <AttachButton
          isUploading={isUploading}
          onUpload={upload}
          className="px-3 py-2 rounded-lg border bg-muted/30 border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-all self-end disabled:opacity-40"
        />
        <button
          onClick={() => isListening ? stopListening() : startListening()}
          className={`px-3 py-2 rounded-lg border transition-all self-end ${
            isListening
              ? "bg-destructive/10 border-destructive/30 text-destructive animate-pulse"
              : "bg-muted/30 border-border text-muted-foreground hover:text-primary hover:border-primary/30"
          }`}
          title={isListening ? "Stop listening" : "Voice input"}
        >
          {isListening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !isComposing) {
              e.preventDefault();
              if (isListening) stopListening();
              handleSend();
            }
          }}
          placeholder={isListening ? "Listening..." : "Address the council..."}
          rows={2}
          disabled={loading}
          className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm font-body resize-none focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground placeholder:font-mono placeholder:text-xs disabled:opacity-50"
        />
        {loading ? (
          <button
            onClick={() => { cancelledRef.current = true; setLoading(false); }}
            className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-all self-end"
            title="Stop"
          >
            <Square size={18} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all self-end"
            title="Send to council"
          >
            <Send size={18} />
          </button>
        )}
      </div>

      {/* Group voice call — all council members simultaneously */}
      <AnimatePresence>
        {groupVoiceOpen && userId && (
          <CouncilGroupVoice
            userId={userId}
            onClose={() => setGroupVoiceOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Per-member / per-persona voice call overlay */}
      <AnimatePresence>
        {voiceTarget && (
          <VoiceChatOverlay
            persona={voiceTarget}
            onClose={() => setVoiceTarget(null)}
            onExchange={voiceTarget.entityType === "council" ? async (userText, replyText) => {
              const uid = userId;
              if (!uid) return;
              const cid = await ensureConversation(uid);
              const ts = Date.now();
              const userMsg: CouncilBoardMessage = {
                id: makeId(), speakerId: "user", speakerName: "Sovereign",
                speakerRole: "You", speakerType: "user", content: userText,
                timestamp: ts, isUser: true,
              };
              const memberMsg: CouncilBoardMessage = {
                id: makeId(), speakerId: voiceTarget.entityId ?? "council",
                speakerName: voiceTarget.name, speakerRole: voiceTarget.role ?? "Council Member",
                speakerType: "council", content: replyText,
                timestamp: ts + 1, isUser: false,
              };
              setMessages(prev => [...prev, userMsg, memberMsg]);
              if (cid) {
                await persist(cid, uid, userMsg);
                await persist(cid, uid, memberMsg);
              }
            } : undefined}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmClear}
        title='Delete "this conversation"?'
        description="This action cannot be undone."
        onConfirm={async () => {
          setConfirmClear(false);
          await handleClear();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
