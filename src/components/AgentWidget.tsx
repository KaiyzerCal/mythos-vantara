// Internal MAVIS personal-use agent widget
// Renders a full chat panel + task log for Google, Social, or General agent
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, CheckCircle2, XCircle, Clock, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
type AgentType = "google" | "social" | "general";

interface Step {
  label:   string;
  detail?: string;
  status:  "done" | "error";
}

interface TaskCard {
  id:      string;
  title:   string;
  steps:   Step[];
  status:  "done" | "error";
}

interface Msg {
  id:     string;
  role:   "user" | "agent";
  text:   string;
  taskId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const makeId = () => Math.random().toString(36).slice(2, 10);
const now    = () => new Date().toISOString();

const AGENT_META: Record<AgentType, { label: string; color: string; starters: string[] }> = {
  google: {
    label:    "Google Agent",
    color:    "#4285f4",
    starters: ["Summarize my unread emails", "What's on my calendar today?", "Find files I shared this week", "Schedule a meeting tomorrow at 2pm"],
  },
  social: {
    label:    "Social Agent",
    color:    "#e1306c",
    starters: ["Write an Instagram caption for my new project", "Draft a LinkedIn post about my latest update", "Give me 5 content ideas for this week", "Rewrite this tweet in a sharper tone"],
  },
  general: {
    label:    "AI Agent",
    color:    "#00c8ff",
    starters: ["Help me brainstorm ideas", "Summarize this topic for me", "Draft a quick outline", "Research this for me"],
  },
};

// ── Task log card ─────────────────────────────────────────────────────────────
function TaskEntry({ task }: { task: TaskCard }) {
  const [open, setOpen] = useState(true);
  const borderClass = task.status === "done" ? "border-green-500/20" : "border-red-500/20";
  const dotClass    = task.status === "done" ? "bg-green-400" : "bg-red-400";

  return (
    <div className={cn("rounded-lg border overflow-hidden text-xs", borderClass)}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-black/20 hover:bg-black/30 transition-colors text-left"
      >
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClass)} />
        <span className="flex-1 font-mono text-white/70 truncate">{task.title}</span>
        <ChevronDown size={10} className={cn("text-white/30 transition-transform shrink-0", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-3 py-2 space-y-1.5 border-t border-white/5">
              {task.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  {s.status === "done"
                    ? <CheckCircle2 size={10} className="text-green-400 shrink-0 mt-0.5" />
                    : <XCircle      size={10} className="text-red-400 shrink-0 mt-0.5" />
                  }
                  <div className="min-w-0">
                    <p className="font-mono text-white/60 leading-relaxed">{s.label}</p>
                    {s.detail && <p className="font-mono text-white/30 text-[9px] truncate">{s.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface AgentWidgetProps {
  agentType: AgentType;
  className?: string;
}

export default function AgentWidget({ agentType, className }: AgentWidgetProps) {
  const meta = AGENT_META[agentType];

  const [messages, setMessages] = useState<Msg[]>([]);
  const [tasks,    setTasks]    = useState<TaskCard[]>([]);
  const [input,    setInput]    = useState("");
  const [sending,  setSending]  = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const taRef       = useRef<HTMLTextAreaElement>(null);
  const historyRef  = useRef<{ role: string; content: string }[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 100) + "px";
  }, [input]);

  const send = useCallback(async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);

    const userMsg: Msg = { id: makeId(), role: "user", text };
    setMessages((p) => [...p, userMsg]);
    historyRef.current = [...historyRef.current, { role: "user", content: text }];

    // Optimistic task card
    const taskId = makeId();
    setTasks((p) => [
      ...p,
      {
        id: taskId,
        title: text.length > 55 ? text.slice(0, 52) + "…" : text,
        steps: [{ label: "Processing…", status: "done" }],
        status: "done",
      },
    ]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const SUPABASE_URL = (window as any).__SUPABASE_URL__ ?? import.meta.env.VITE_SUPABASE_URL;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-mini-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          agent_type: agentType,
          message:    text,
          history:    historyRef.current.slice(-16),
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const { reply, steps = [] } = await res.json();

      const agentMsg: Msg = { id: makeId(), role: "agent", text: reply, taskId };
      setMessages((p) => [...p, agentMsg]);
      historyRef.current = [...historyRef.current, { role: "agent", content: reply }];

      setTasks((p) =>
        p.map((t) =>
          t.id === taskId
            ? {
                ...t,
                steps: steps.length
                  ? steps.map((s: any) => ({ label: s.label, detail: s.detail, status: "done" as const }))
                  : [{ label: "Completed", status: "done" as const }],
              }
            : t
        )
      );
    } catch (err: any) {
      toast.error("Agent failed to respond.");
      setTasks((p) =>
        p.map((t) =>
          t.id === taskId
            ? { ...t, steps: [{ label: err?.message ?? "Error", status: "error" as const }], status: "error" as const }
            : t
        )
      );
    } finally {
      setSending(false);
    }
  }, [input, sending, agentType]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className={cn("flex h-full overflow-hidden rounded-xl border border-white/10 bg-[#0d1117]", className)}>
      {/* Chat — 65% */}
      <div className="flex flex-col flex-1 min-w-0 border-r border-white/8">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/8 shrink-0">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold"
            style={{ backgroundColor: meta.color + "22", color: meta.color, border: `1px solid ${meta.color}33` }}
          >
            {agentType === "google" ? "G" : agentType === "social" ? "S" : "AI"}
          </div>
          <span className="text-[12px] font-semibold text-white/80">{meta.label}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: meta.color }} />
            <span className="text-[9px] font-mono text-white/30">online</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && !sending && (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-8 text-center">
              <p className="text-[11px] text-white/30 font-mono">Try asking:</p>
              <div className="flex flex-col gap-1.5 w-full max-w-xs">
                {meta.starters.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="text-[10px] font-mono text-white/40 border border-white/8 rounded-lg px-3 py-2 hover:border-white/15 hover:text-white/60 transition-colors text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[78%] rounded-xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-white/8 text-white/85 rounded-tr-sm"
                    : "bg-black/30 text-white/70 border border-white/5 rounded-tl-sm"
                )}
              >
                {m.text}
              </div>
            </motion.div>
          ))}

          <AnimatePresence>
            {sending && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-start">
                <div className="bg-black/30 border border-white/5 rounded-xl rounded-tl-sm px-3 py-2.5 flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="w-1 h-1 rounded-full"
                      style={{ backgroundColor: meta.color + "80" }}
                      animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                      transition={{ duration: 1, delay: i * 0.2, repeat: Infinity }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-3 pb-3 pt-2">
          <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 focus-within:border-white/20 transition-colors">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={`Message ${meta.label}…`}
              disabled={sending}
              className="flex-1 resize-none bg-transparent text-[12px] text-white/80 placeholder:text-white/20 focus:outline-none leading-relaxed min-h-[20px] max-h-[100px] py-0.5 disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              className={cn(
                "shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-all",
                input.trim() && !sending
                  ? "text-white/70 hover:text-white"
                  : "text-white/15 cursor-not-allowed"
              )}
              style={input.trim() && !sending ? { color: meta.color } : {}}
            >
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* Task log — 35% */}
      <div className="w-[35%] shrink-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-3 border-b border-white/8 shrink-0">
          <Clock size={10} className="text-white/30" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-white/30">Task Log</span>
          {tasks.length > 0 && (
            <span className="ml-auto text-[9px] font-mono text-white/20">{tasks.length}</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center h-20">
              <p className="text-[9px] font-mono text-white/20">Tasks appear here</p>
            </div>
          ) : (
            [...tasks].reverse().map((t) => <TaskEntry key={t.id} task={t} />)
          )}
        </div>
      </div>
    </div>
  );
}
