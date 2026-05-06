import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, ArrowLeft, Users, Database, Square, Mic, MicOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadFullAppContext } from "@/mavis/appContextLoader";
import {
  sendCouncilMessage,
  type CouncilBoardMessage,
} from "@/mavis/councilBoardService";
import type { CouncilMember } from "@/mavis/councilPersona";
import { parseProposedActions, submitProposalsForApproval } from "@/mavis/proposeAction";
import { ScrollProgressBar, BackToTopButton, ScrollToBottomButton, EndOfFeed } from "@/components/chat/ScrollKit";
import { AttachmentTray, AttachButton } from "@/components/chat/AttachmentTray";
import { CopyButton } from "@/components/chat/CopyButton";
import { useChatAttachments } from "@/hooks/useChatAttachments";
import { toast } from "sonner";

// ── Speaker styling by hash ──────────────────────────────────────────
const MEMBER_COLORS = [
  { border: "border-blue-500/40", badge: "bg-blue-600", label: "text-blue-400" },
  { border: "border-green-500/40", badge: "bg-green-600", label: "text-green-400" },
  { border: "border-orange-500/40", badge: "bg-orange-600", label: "text-orange-400" },
  { border: "border-pink-500/40", badge: "bg-pink-600", label: "text-pink-400" },
  { border: "border-cyan-500/40", badge: "bg-cyan-600", label: "text-cyan-400" },
  { border: "border-rose-500/40", badge: "bg-rose-600", label: "text-rose-400" },
];

function speakerStyle(speakerId: string, isUser: boolean) {
  if (isUser) return { border: "border-primary/30", badge: "bg-primary/80", label: "text-primary" };
  if (speakerId === "mavis") return { border: "border-purple-500/40", badge: "bg-purple-700", label: "text-purple-300" };
  const hash = speakerId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return MEMBER_COLORS[hash % MEMBER_COLORS.length];
}

const makeId = () => crypto.randomUUID();
const THREAD_REF = "council-board";

export default function CouncilBoard() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<CouncilBoardMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [councilMembers, setCouncilMembers] = useState<CouncilMember[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const cancelledRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  const { attachments, isUploading, upload, remove } = useChatAttachments("council", THREAD_REF);

  // ── Load user, members, and persisted thread ────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { toast.error("Not authenticated"); return; }
      const uid = session.user.id;
      setUserId(uid);

      try {
        const { data: members } = await supabase
          .from("councils").select("*").eq("user_id", uid).order("name");
        setCouncilMembers((members ?? []) as CouncilMember[]);
      } catch { toast.error("Failed to load council members"); }

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
            // Encode speaker info in mode field as `speakerId|speakerName|speakerRole`
            const parts = (m.mode ?? "").split("|");
            const isUser = m.role === "user";
            return {
              id: m.id,
              speakerId: isUser ? "user" : (parts[0] || "mavis"),
              speakerName: isUser ? "Sovereign" : (parts[1] || "MAVIS"),
              speakerRole: isUser ? "You" : (parts[2] || "Supreme Intelligence"),
              content: m.content,
              timestamp: new Date(m.created_at).getTime(),
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
        role: m.isUser ? "user" : "assistant",
        content: m.content,
        mode: m.isUser ? "USER" : `${m.speakerId}|${m.speakerName}|${m.speakerRole}`,
      });
    } catch (err) { console.error(err); }
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

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

  // ── OmniSync ─────────────────────────────────────────────────────
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

  // ── Clear: archive then wipe ─────────────────────────────────────
  const handleClear = useCallback(async () => {
    if (!userId) return;
    try {
      await handleOmniSync();
      if (messages.length > 0) {
        const fullThread = messages
          .map(m => `[${m.speakerName} — ${m.speakerRole}] ${m.content}`).join("\n\n");
        await supabase.from("memories").insert({
          user_id: userId,
          title: `Council Board — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
          content: fullThread.slice(0, 50000),
          memory_type: "conversation",
          source: "council_chat_clear",
          tags: ["council-board", "archived"],
          metadata: { message_count: messages.length, cleared_at: new Date().toISOString() },
        });
      }
      if (conversationId) {
        await supabase.from("chat_messages").delete().eq("conversation_id", conversationId).eq("user_id", userId);
        await supabase.from("chat_conversations").delete().eq("id", conversationId).eq("user_id", userId);
      }
      setMessages([]);
      setConversationId(null);
      toast.success("Thread archived — memories preserved");
    } catch (e: any) {
      toast.error("Clear failed: " + (e?.message ?? "unknown"));
    }
  }, [userId, messages, conversationId, handleOmniSync]);

  // ── Send ─────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || loading || !userId) return;
    const text = input.trim();
    setInput("");
    setLoading(true);
    cancelledRef.current = false;

    const cid = await ensureConversation(userId);

    const userMsg: CouncilBoardMessage = {
      id: makeId(), speakerId: "user", speakerName: "Sovereign",
      speakerRole: "You", content: text, timestamp: Date.now(), isUser: true,
    };
    setMessages(prev => [...prev, userMsg]);
    if (cid) await persist(cid, userId, userMsg);

    try {
      const appContext = await loadFullAppContext(userId);
      const result = await sendCouncilMessage(text, messages, councilMembers, appContext);
      if (cancelledRef.current) return;

      const newMsgs: CouncilBoardMessage[] = [];

      // MAVIS reply — parse proposals
      const mavis = parseProposedActions(result.mavisResponse);
      if (mavis.proposals.length > 0) {
        const n = await submitProposalsForApproval(userId, "MAVIS", mavis.proposals);
        if (n > 0) toast.success(`MAVIS proposed ${n} action${n > 1 ? "s" : ""} — awaiting approval`);
      }
      newMsgs.push({
        id: makeId(), speakerId: "mavis", speakerName: "MAVIS",
        speakerRole: "Supreme Intelligence", content: mavis.cleanText || result.mavisResponse,
        timestamp: Date.now(), isUser: false,
      });

      // Each council member — parse proposals
      for (const r of result.memberResponses) {
        const parsed = parseProposedActions(r.response);
        if (parsed.proposals.length > 0) {
          const n = await submitProposalsForApproval(userId, r.member.name, parsed.proposals);
          if (n > 0) toast.success(`${r.member.name} proposed ${n} action${n > 1 ? "s" : ""} — awaiting approval`);
        }
        newMsgs.push({
          id: makeId(), speakerId: r.member.id, speakerName: r.member.name,
          speakerRole: r.member.role ?? "Council Member",
          content: parsed.cleanText || r.response,
          timestamp: Date.now(), isUser: false,
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
        content: "The council session encountered an error. Please try again.",
        timestamp: Date.now(), isUser: false,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, userId, messages, councilMembers, ensureConversation, persist]);

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
          <p className="text-[10px] font-mono text-muted-foreground truncate">
            {councilMembers.length} member{councilMembers.length !== 1 ? "s" : ""} · MAVIS presiding
          </p>
        </div>
        <button
          onClick={handleOmniSync}
          disabled={isSyncing}
          className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 hover:border-cyan-400/40 rounded px-2 py-1 transition-all disabled:opacity-40"
        >
          <Database size={10} /> OmniSync
        </button>
        <button
          onClick={handleClear}
          className="text-[10px] font-mono text-muted-foreground hover:text-destructive border border-border hover:border-destructive/40 rounded px-2 py-1 transition-colors"
        >
          Clear
        </button>
      </div>

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
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map(msg => {
              const style = speakerStyle(msg.speakerId, msg.isUser);
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`border-l-2 ${style.border} pl-3 py-1.5`}
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded text-white ${style.badge}`}>
                      {msg.speakerName}
                    </span>
                    <span className={`text-[9px] font-mono ${style.label}`}>{msg.speakerRole}</span>
                    <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">
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
                <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded text-white bg-purple-700">Council</span>
                <span className="text-[9px] font-mono text-purple-300">deliberating...</span>
              </div>
              <div className="flex gap-1 mt-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
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
    </div>
  );
}
