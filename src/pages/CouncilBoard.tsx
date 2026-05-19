import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, ArrowLeft, Users, Database, Square, Mic, MicOff, Zap, ChevronDown, ChevronUp, PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadFullAppContext } from "@/mavis/appContextLoader";
import {
  sendCouncilMessage,
  type CouncilBoardMessage,
} from "@/mavis/councilBoardService";
import type { CouncilMember } from "@/mavis/councilPersona";
import { buildCouncilMemberPrompt, buildContextSummary } from "@/mavis/councilPersona";
import { buildPersonaCouncilPrompt } from "@/mavis/agentPersona";
import type { AppContextSnapshot } from "@/mavis/appContextLoader";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";
import type { VoicePersona } from "@/components/VoiceChatOverlay";
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
  const [voiceHistory,     setVoiceHistory]     = useState<{ role: string; content: string }[]>([]);
  const [appCtx,           setAppCtx]           = useState<AppContextSnapshot | null>(null);

  const cancelledRef   = useRef(false);
  const scrollRef      = useRef<HTMLDivElement>(null);
  const bottomRef      = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  const { attachments, isUploading, upload, remove } = useChatAttachments("council", THREAD_REF);

  // ── Load user, members, personas, and persisted thread ───────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { toast.error("Not authenticated"); return; }
      const uid = session.user.id;
      setUserId(uid);

      // Pre-load app context for voice calls (60s cache — fast after first load)
      loadFullAppContext(uid).then(setAppCtx).catch(() => {/* non-fatal */});

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
          .select("*").eq("conversation_id", cid).eq("user_id", uid)
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

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

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

  // ── Voice overlay: load history + persist exchanges ──────────────
  const handleVoiceOpen = useCallback(async (target: VoicePersona) => {
    setVoiceTarget(target);
    if (!userId || !target.entityId) { setVoiceHistory([]); return; }
    try {
      let rows: { role: string; content: string }[] = [];
      if (target.entityType === "council") {
        const { data } = await supabase
          .from("council_chat_messages")
          .select("role, content")
          .eq("council_member_id", target.entityId)
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(40);
        rows = data ?? [];
      } else if (target.entityType === "persona") {
        const { data } = await supabase
          .from("persona_conversations")
          .select("role, content")
          .eq("persona_id", target.entityId)
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(40);
        rows = data ?? [];
      }
      setVoiceHistory(rows.map(r => ({ role: r.role, content: r.content })));
    } catch { setVoiceHistory([]); }
  }, [userId]);

  const handleVoiceExchange = useCallback(async (userMsg: string, aiMsg: string) => {
    if (!userId || !voiceTarget?.entityId) return;
    try {
      if (voiceTarget.entityType === "council") {
        await supabase.from("council_chat_messages").insert([
          { user_id: userId, council_member_id: voiceTarget.entityId, role: "user",      content: userMsg },
          { user_id: userId, council_member_id: voiceTarget.entityId, role: "assistant", content: aiMsg  },
        ]);
      } else if (voiceTarget.entityType === "persona") {
        await supabase.from("persona_conversations").insert([
          { user_id: userId, persona_id: voiceTarget.entityId, role: "user",      content: userMsg },
          { user_id: userId, persona_id: voiceTarget.entityId, role: "assistant", content: aiMsg  },
        ]);
      }
    } catch (err) { console.error("[CouncilBoard] voice exchange persist failed:", err); }
  }, [userId, voiceTarget]);

  // ── Send ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || loading || !userId) return;
    const text = input.trim();
    setInput("");
    setLoading(true);
    cancelledRef.current = false;

    const cid = await ensureConversation(userId);

    const userMsg: CouncilBoardMessage = {
      id: makeId(), speakerId: "user", speakerName: "Sovereign",
      speakerRole: "You", speakerType: "user", content: text, timestamp: Date.now(), isUser: true,
    };
    setMessages(prev => [...prev, userMsg]);
    if (cid) await persist(cid, userId, userMsg);

    try {
      const appContext = await loadFullAppContext(userId);

      // Build summoned personas list
      const summonedPersonas = personas.filter(p => summonedIds.includes(p.id));

      const result = await sendCouncilMessage(
        text,
        messages,
        councilMembers,
        appContext,
        { summonedPersonas },
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

      // Persona replies (summoned)
      for (const r of (result.personaResponses ?? [])) {
        const parsed = parseProposedActions(r.response);
        newMsgs.push({
          id: makeId(), speakerId: r.persona.id, speakerName: r.persona.name,
          speakerRole: r.persona.role ?? "Persona", speakerType: "persona",
          content: parsed.cleanText || r.response,
          timestamp: Date.now(), isUser: false,
          summoned: r.summoned,
        });
      }

      setMessages(prev => [...prev, ...newMsgs]);
      if (cid) for (const m of newMsgs) await persist(cid, userId, m);
    } catch (err: any) {
      if (cancelledRef.current) return;
      console.error(err);
      toast.error("Council session error — " + (err?.message ?? "unknown"));
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
    <div className="-m-5 h-screen flex flex-col overflow-hidden bg-background">
      {/* Header — fixed single row, never grows */}
      <div className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-border bg-card/50">
        <button onClick={() => navigate("/mavis")} className="text-muted-foreground hover:text-primary transition-colors" title="Back to MAVIS">
          <ArrowLeft size={16} />
        </button>
        <Users size={16} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-mono font-bold text-primary leading-tight">Council Board</h1>
          <p className="text-[10px] font-mono text-muted-foreground truncate">
            {councilMembers.length} member{councilMembers.length !== 1 ? "s" : ""}
            {activeSummonedPersonas.length > 0 && ` · ${activeSummonedPersonas.length} persona${activeSummonedPersonas.length > 1 ? "s" : ""} summoned`}
            {" · MAVIS presiding"}
          </p>
        </div>
        {/* Persona summon toggle */}
        {personas.length > 0 && (
          <button
            onClick={() => setShowPersonaPanel(v => !v)}
            className="flex items-center gap-1 text-[10px] font-mono text-amber-400 hover:text-amber-300 border border-amber-900/40 hover:border-amber-400/40 rounded px-2 py-1 transition-all shrink-0"
            title="Summon personas"
          >
            <Zap size={10} />
            Summon
            {showPersonaPanel ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
        <button
          onClick={handleOmniSync}
          disabled={isSyncing}
          className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 hover:border-cyan-400/40 rounded px-2 py-1 transition-all disabled:opacity-40 shrink-0"
        >
          <Database size={10} /> OmniSync
        </button>
        <button
          onClick={handleClear}
          className="text-[10px] font-mono text-muted-foreground hover:text-destructive border border-border hover:border-destructive/40 rounded px-2 py-1 transition-colors shrink-0"
        >
          Clear
        </button>
      </div>

      {/* Voice call chips — single scrollable row, never wraps */}
      {councilMembers.length > 0 && (
        <div className="shrink-0 h-9 flex items-center gap-1.5 px-4 border-b border-border/40 bg-muted/10 overflow-x-auto scrollbar-none">
          {councilMembers.map((m) => (
            <button
              key={m.id}
              onClick={() => handleVoiceOpen({
                name: m.name,
                role: m.role ?? m.specialty,
                systemPrompt: buildCouncilMemberPrompt(m, appCtx ? buildContextSummary(appCtx) : ""),
                voiceId: m.voice_id ?? undefined,
                entityId: m.id,
                entityType: "council",
              })}
              className="flex items-center gap-1 text-[9px] font-mono text-primary/60 hover:text-primary border border-primary/20 hover:border-primary/40 rounded px-1.5 py-0.5 whitespace-nowrap shrink-0 transition-all"
              title={`Voice call ${m.name}`}
            >
              <PhoneCall size={8} /> {m.name}
            </button>
          ))}
        </div>
      )}

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
              <p className="text-[10px] font-mono text-amber-400/70 uppercase tracking-wider">Summon into session</p>
              <div className="flex flex-wrap gap-1.5">
                {availablePersonas.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSummon(p)}
                    className="flex items-center gap-1 text-[10px] font-mono text-amber-300 border border-amber-700/40 bg-amber-900/20 hover:bg-amber-800/30 hover:border-amber-500/50 rounded px-2 py-1 transition-all"
                  >
                    <Zap size={8} /> {p.name}
                    {p.role && <span className="text-amber-500/60 ml-0.5">· {p.role}</span>}
                  </button>
                ))}
                {availablePersonas.length === 0 && (
                  <span className="text-[10px] font-mono text-muted-foreground/50">All personas are in session.</span>
                )}
              </div>
              {activeSummonedPersonas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-amber-900/30">
                  <span className="text-[10px] font-mono text-amber-500/50 self-center">In session:</span>
                  {activeSummonedPersonas.map(p => (
                    <div key={p.id} className="flex items-center gap-0.5">
                      <button
                        onClick={() => handleUnsummon(p.id)}
                        className="flex items-center gap-1 text-[10px] font-mono text-amber-200 border border-amber-500/40 bg-amber-800/30 hover:bg-red-900/30 hover:border-red-500/40 hover:text-red-300 rounded-l px-2 py-1 transition-all"
                        title="Remove from session"
                      >
                        {p.name} ×
                      </button>
                      <button
                        onClick={() => handleVoiceOpen({
                          name: p.name,
                          role: p.role,
                          systemPrompt: appCtx ? buildPersonaCouncilPrompt(p, appCtx) : (p.systemPrompt ?? ""),
                          voiceId: (p as unknown as Record<string, unknown>).voice_id as string | undefined,
                          entityId: p.id,
                          entityType: "persona",
                        })}
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

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <ScrollProgressBar progress={scrollProgress} />
        <BackToTopButton visible={showBackToTop} onClick={scrollToTop} />
        <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
              <Users size={32} className="text-muted-foreground/40" />
              <p className="text-sm font-mono text-muted-foreground">The council awaits your address.</p>
              <p className="text-[11px] font-mono text-muted-foreground/60">
                MAVIS responds first — council members weigh in based on relevance.
              </p>
              {personas.length > 0 && (
                <p className="text-[10px] font-mono text-amber-500/50">
                  {personas.length} persona{personas.length !== 1 ? "s" : ""} available to summon via ⚡
                </p>
              )}
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map(msg => {
              const style = speakerStyle(msg.speakerId, msg.isUser, msg.speakerType);

              // System / event messages → centred divider
              if (msg.speakerId === "system") {
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-3 my-1"
                  >
                    <div className="flex-1 h-px bg-border/30" />
                    <span className="text-[10px] font-mono text-muted-foreground/50 px-2 shrink-0">
                      {msg.content}
                    </span>
                    <div className="flex-1 h-px bg-border/30" />
                  </motion.div>
                );
              }

              const initials = msg.speakerName.slice(0, 2).toUpperCase();
              const isUser = msg.isUser;

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 mt-0.5 ${style.badge}`}
                  >
                    {initials}
                  </div>

                  {/* Bubble column */}
                  <div className={`flex flex-col gap-1 max-w-[78%] ${isUser ? "items-end" : "items-start"}`}>
                    {/* Speaker meta (non-user only) */}
                    {!isUser && (
                      <div className="flex items-center gap-1.5 px-1">
                        <span className={`text-[10px] font-mono font-semibold ${style.label}`}>
                          {msg.speakerName}
                        </span>
                        {msg.speakerRole && (
                          <span className="text-[9px] font-mono text-muted-foreground/50">
                            · {msg.speakerRole}
                          </span>
                        )}
                        {msg.speakerType === "council" && (
                          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-purple-900/50 text-purple-300 border border-purple-700/40">
                            COUNCIL
                          </span>
                        )}
                        {msg.speakerType === "persona" && (
                          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-700/40">
                            {msg.summoned ? "⚡ PERSONA" : "PERSONA"}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Message bubble */}
                    <div
                      className={[
                        "px-4 py-3 rounded-2xl",
                        isUser
                          ? "bg-primary text-white rounded-tr-sm shadow-md shadow-primary/20"
                          : "bg-card border border-border text-foreground rounded-tl-sm",
                      ].join(" ")}
                    >
                      <p className="text-sm font-body leading-relaxed whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    </div>

                    {/* Timestamp + copy */}
                    <div className={`flex items-center gap-2 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                      <span className="text-[9px] font-mono text-muted-foreground/40">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <CopyButton content={msg.content} />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2.5">
              <div className="w-8 h-8 rounded-full bg-purple-700 flex items-center justify-center text-white text-[11px] font-bold shrink-0 mt-0.5">
                CO
              </div>
              <div className="flex flex-col gap-1 items-start">
                <span className="text-[10px] font-mono text-purple-300 px-1">Council · deliberating...</span>
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-card border border-border flex items-center gap-1.5 h-10">
                  {[0, 1, 2].map(i => (
                    <span key={i} className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}

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

      {/* Per-member / per-persona voice call overlay */}
      <AnimatePresence>
        {voiceTarget && (
          <VoiceChatOverlay
            persona={voiceTarget}
            onClose={() => setVoiceTarget(null)}
            initialHistory={voiceHistory}
            onExchange={handleVoiceExchange}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
