import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, ArrowLeft, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadFullAppContext } from "@/mavis/appContextLoader";
import {
  sendCouncilMessage,
  type CouncilBoardMessage,
} from "@/mavis/councilBoardService";
import type { CouncilMember } from "@/mavis/councilPersona";
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

function makeId() {
  return crypto.randomUUID();
}

export default function CouncilBoard() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<CouncilBoardMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [councilMembers, setCouncilMembers] = useState<CouncilMember[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Get user + load council members on mount ────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { toast.error("Not authenticated"); return; }
      setUserId(session.user.id);

      try {
        const { data, error } = await supabase
          .from("councils")
          .select("*")
          .eq("user_id", session.user.id)
          .order("name");
        if (error) throw error;
        setCouncilMembers((data ?? []) as CouncilMember[]);
      } catch (err: any) {
        console.error("[CouncilBoard] Failed to load council:", err);
        toast.error("Failed to load council members");
      }
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading || !userId) return;
    const text = input.trim();
    setInput("");
    setLoading(true);

    const userMsg: CouncilBoardMessage = {
      id: makeId(),
      speakerId: "user",
      speakerName: "Sovereign",
      speakerRole: "You",
      content: text,
      timestamp: Date.now(),
      isUser: true,
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const appContext = await loadFullAppContext(userId);

      const result = await sendCouncilMessage(
        text,
        messages,
        councilMembers,
        appContext,
      );

      const newMsgs: CouncilBoardMessage[] = [
        {
          id: makeId(),
          speakerId: "mavis",
          speakerName: "MAVIS",
          speakerRole: "Supreme Intelligence",
          content: result.mavisResponse,
          timestamp: Date.now(),
          isUser: false,
        },
        ...result.memberResponses.map(r => ({
          id: makeId(),
          speakerId: r.member.id,
          speakerName: r.member.name,
          speakerRole: r.member.role ?? "Council Member",
          content: r.response,
          timestamp: Date.now(),
          isUser: false,
        })),
      ];

      setMessages(prev => [...prev, ...newMsgs]);
    } catch (err: any) {
      console.error("[CouncilBoard]", err);
      toast.error("Council session error — " + (err.message ?? "unknown"));
      setMessages(prev => [...prev, {
        id: makeId(),
        speakerId: "system",
        speakerName: "System",
        speakerRole: "Error",
        content: "The council session encountered an error. Please try again.",
        timestamp: Date.now(),
        isUser: false,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, userId, messages, councilMembers]);

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] gap-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50">
        <button
          onClick={() => navigate("/mavis")}
          className="text-muted-foreground hover:text-primary transition-colors"
          title="Back to MAVIS"
        >
          <ArrowLeft size={16} />
        </button>
        <Users size={16} className="text-primary" />
        <div className="flex-1">
          <h1 className="text-sm font-mono font-bold text-primary">Council Board</h1>
          <p className="text-[10px] font-mono text-muted-foreground">
            {councilMembers.length} member{councilMembers.length !== 1 ? "s" : ""} · MAVIS presiding
          </p>
        </div>
        {councilMembers.length > 0 && (
          <div className="hidden sm:flex gap-1.5 flex-wrap justify-end max-w-xs">
            {councilMembers.slice(0, 5).map(m => (
              <span key={m.id} className="text-[9px] font-mono bg-muted/30 border border-border px-1.5 py-0.5 rounded-full text-muted-foreground">
                {m.name}
              </span>
            ))}
            {councilMembers.length > 5 && (
              <span className="text-[9px] font-mono text-muted-foreground">+{councilMembers.length - 5}</span>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 scrollbar-thin">
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
                </div>
                <p className="text-xs font-body text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="border-l-2 border-purple-500/40 pl-3 py-1.5"
          >
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

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-3 flex gap-2 bg-card/30">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Address the council..."
          rows={2}
          disabled={loading}
          className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm font-body resize-none focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground placeholder:font-mono placeholder:text-xs disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all self-end"
          title="Send to council"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
