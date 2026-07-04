// ============================================================
// VANTARA.EXE — Agent Console
// Multi-panel autonomous coding agent UI
// Left: task/chat input | Center: agent feed | Right: terminals
// ============================================================
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Square, Plus, X, Play, Loader2, Terminal,
  CheckCircle2, XCircle, AlertTriangle, Zap, Code2,
  Globe, GitBranch, FileCode, Trash2, Copy, Check,
  ChevronRight, RotateCcw,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";

const supabase = _supabase as any;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

// ── Types ────────────────────────────────────────────────────

type AgentStep = {
  id: string;
  type: "thinking" | "tool_call" | "result" | "error";
  label: string;
  detail?: string;
  ts: Date;
};

type TerminalSession = {
  id: string;
  label: string;
  language: "python" | "node" | "typescript" | "bash";
  entries: TerminalEntry[];
  running: boolean;
};

type TerminalEntry = {
  id: string;
  type: "input" | "stdout" | "stderr" | "error" | "info";
  text: string;
  ts: Date;
};

type AgentMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  steps: AgentStep[];
  ts: Date;
};

const LANG_COLORS: Record<string, string> = {
  python: "text-yellow-400",
  node: "text-green-400",
  typescript: "text-blue-400",
  bash: "text-orange-400",
};

const LANG_LABELS: Record<string, string> = {
  python: "Python",
  node: "Node.js",
  typescript: "TypeScript",
  bash: "Bash",
};

// ── Terminal Panel ────────────────────────────────────────────

function TerminalPanel({
  session,
  onRun,
  onClear,
  onClose,
  isActive,
  onActivate,
}: {
  session: TerminalSession;
  onRun: (code: string, lang: string) => void;
  onClear: () => void;
  onClose: () => void;
  isActive: boolean;
  onActivate: () => void;
}) {
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [session.entries]);

  const run = () => {
    if (!input.trim() || session.running) return;
    onRun(input.trim(), session.language);
    setInput("");
  };

  const copyOutput = () => {
    const text = session.entries.map(e => e.text).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={`flex flex-col h-full border rounded-lg overflow-hidden transition-colors ${
        isActive ? "border-primary/40" : "border-zinc-700/50"
      }`}
      onClick={onActivate}
    >
      {/* Terminal header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className={`w-2 h-2 rounded-full ${session.running ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`} />
        <span className={`text-xs font-mono ${LANG_COLORS[session.language]}`}>
          {LANG_LABELS[session.language]}
        </span>
        <span className="text-xs text-zinc-600 truncate flex-1">{session.label}</span>
        <button onClick={copyOutput} className="text-zinc-600 hover:text-zinc-300 p-0.5">
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
        <button onClick={onClear} className="text-zinc-600 hover:text-zinc-300 p-0.5">
          <Trash2 size={11} />
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-red-400 p-0.5">
          <X size={11} />
        </button>
      </div>

      {/* Output area */}
      <div ref={outputRef} className="flex-1 overflow-y-auto p-3 bg-black/40 font-mono text-[11px] leading-relaxed space-y-0.5">
        {session.entries.length === 0 && (
          <p className="text-zinc-600 italic">Ready. Type code and press Enter or Run.</p>
        )}
        {session.entries.map(entry => (
          <div key={entry.id} className={
            entry.type === "input" ? "text-cyan-400" :
            entry.type === "stdout" ? "text-zinc-200" :
            entry.type === "stderr" ? "text-yellow-400" :
            entry.type === "error" ? "text-red-400" :
            "text-zinc-500 italic"
          }>
            {entry.type === "input" ? `$ ${entry.text}` : entry.text}
          </div>
        ))}
        {session.running && (
          <div className="text-zinc-500 flex items-center gap-1">
            <Loader2 size={9} className="animate-spin" /> executing...
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-zinc-900 border-t border-zinc-800 shrink-0">
        <span className="text-zinc-500 font-mono text-xs">$</span>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } }}
          placeholder={`${session.language} code... (Enter to run, Shift+Enter newline)`}
          className="flex-1 bg-transparent text-xs font-mono text-zinc-200 resize-none outline-none placeholder:text-zinc-600 min-h-[20px] max-h-[80px]"
          rows={1}
        />
        <button
          onClick={run}
          disabled={session.running || !input.trim()}
          className="p-1 text-zinc-500 hover:text-primary disabled:opacity-30"
        >
          {session.running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        </button>
      </div>
    </div>
  );
}

// ── Main AgentConsole ─────────────────────────────────────────

export function AgentConsole() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  // Task / agent state
  const [taskInput, setTaskInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Terminal sessions
  const [terminals, setTerminals] = useState<TerminalSession[]>([
    { id: "t1", label: "Shell 1", language: "python", entries: [], running: false },
  ]);
  const [activeTerminal, setActiveTerminal] = useState("t1");

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [agentMessages]);

  // ── Run a task through MAVIS agent ───────────────────────────
  const runTask = useCallback(async () => {
    const task = taskInput.trim();
    if (!task || agentRunning) return;
    setTaskInput("");
    setAgentRunning(true);
    abortRef.current = new AbortController();

    const msgId = `am-${Date.now()}`;
    const userMsg: AgentMessage = {
      id: `u-${Date.now()}`, role: "user", content: task, steps: [], ts: new Date()
    };
    const agentMsg: AgentMessage = {
      id: msgId, role: "agent", content: "", steps: [], ts: new Date()
    };
    setAgentMessages(prev => [...prev, userMsg, agentMsg]);

    const addStep = (step: Omit<AgentStep, "id" | "ts">) => {
      setAgentMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, steps: [...m.steps, { ...step, id: `s-${Date.now()}-${Math.random()}`, ts: new Date() }] } : m
      ));
    };

    try {
      addStep({ type: "thinking", label: "Analyzing task...", detail: task });

      const { data, error } = await supabase.functions.invoke("mavis-agent", {
        body: { goal: task, messages: [], userId: session?.user?.id },
      });

      if (error) throw error;

      const content = data?.content ?? data?.response ?? data?.result ?? JSON.stringify(data);
      const toolsUsed: string[] = data?.toolsUsed ?? data?.tools_used ?? [];

      if (toolsUsed.length > 0) {
        toolsUsed.forEach(tool => {
          addStep({ type: "tool_call", label: tool, detail: `Tool invoked: ${tool}` });
        });
      }

      addStep({ type: "result", label: "Complete", detail: `${content.length} chars` });
      setAgentMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content } : m
      ));
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const errMsg = err?.message ?? "Agent task failed";
      addStep({ type: "error", label: "Error", detail: errMsg });
      setAgentMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content: `**Error:** ${errMsg}` } : m
      ));
      toast.error(errMsg);
    } finally {
      setAgentRunning(false);
    }
  }, [taskInput, agentRunning, token, session]);

  // ── Execute code in a terminal session ──────────────────────
  const runInTerminal = useCallback(async (termId: string, code: string, language: string) => {
    setTerminals(prev => prev.map(t =>
      t.id === termId ? {
        ...t,
        running: true,
        entries: [...t.entries, { id: `e-${Date.now()}`, type: "input", text: code, ts: new Date() }]
      } : t
    ));

    try {
      const sandboxUrl = `${SB_URL}/functions/v1/mavis-code-exec`;
      const res = await fetch(sandboxUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code, language }),
      });

      const data = await res.json();
      const newEntries: TerminalEntry[] = [];

      if (data.stdout) {
        newEntries.push({ id: `e-${Date.now()}-out`, type: "stdout", text: data.stdout, ts: new Date() });
      }
      if (data.stderr) {
        newEntries.push({ id: `e-${Date.now()}-err`, type: "stderr", text: data.stderr, ts: new Date() });
      }
      if (data.error) {
        newEntries.push({ id: `e-${Date.now()}-exc`, type: "error", text: data.error, ts: new Date() });
      }
      if (newEntries.length === 0) {
        newEntries.push({ id: `e-${Date.now()}-ok`, type: "info", text: "(no output)", ts: new Date() });
      }

      setTerminals(prev => prev.map(t =>
        t.id === termId ? { ...t, running: false, entries: [...t.entries, ...newEntries] } : t
      ));
    } catch (err: any) {
      setTerminals(prev => prev.map(t =>
        t.id === termId ? {
          ...t, running: false,
          entries: [...t.entries, { id: `e-${Date.now()}-err`, type: "error", text: err.message ?? "Execution failed", ts: new Date() }]
        } : t
      ));
    }
  }, [token]);

  const addTerminal = () => {
    const langs: TerminalSession["language"][] = ["python", "node", "typescript", "bash"];
    const lang = langs[(terminals.length) % langs.length];
    const id = `t-${Date.now()}`;
    setTerminals(prev => [...prev, { id, label: `Shell ${prev.length + 1}`, language: lang, entries: [], running: false }]);
    setActiveTerminal(id);
  };

  const closeTerminal = (id: string) => {
    setTerminals(prev => prev.filter(t => t.id !== id));
    if (activeTerminal === id) {
      setActiveTerminal(terminals.find(t => t.id !== id)?.id ?? "");
    }
  };

  const clearTerminal = (id: string) => {
    setTerminals(prev => prev.map(t => t.id === id ? { ...t, entries: [] } : t));
  };

  const changeTerminalLang = (id: string, lang: TerminalSession["language"]) => {
    setTerminals(prev => prev.map(t => t.id === id ? { ...t, language: lang } : t));
  };

  const stopAgent = () => {
    abortRef.current?.abort();
    setAgentRunning(false);
  };

  // Quick task chips
  const QUICK_TASKS = [
    { label: "Analyze codebase", prompt: "Analyze the current codebase structure, identify patterns, potential issues, and areas for improvement." },
    { label: "Write unit tests", prompt: "Propose unit tests for the most critical parts of the MAVIS system." },
    { label: "Security audit", prompt: "Perform a security audit of the application focusing on authentication, data exposure, and injection risks." },
    { label: "Optimize performance", prompt: "Identify performance bottlenecks in the React frontend and suggest optimizations." },
    { label: "Review edge functions", prompt: "Review the Supabase edge functions for correctness, error handling, and security." },
    { label: "Git status", prompt: "Check git status and summarize what files have been modified recently." },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background font-mono">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-zinc-950 shrink-0">
        <div className="w-7 h-7 rounded bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Terminal size={14} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xs font-display font-bold text-primary tracking-widest">AGENT CONSOLE</h1>
          <p className="text-[10px] text-zinc-500 font-mono">VANTARA autonomous coding intelligence</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border ${agentRunning ? "border-yellow-500/30 text-yellow-400 bg-yellow-500/10" : "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${agentRunning ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`} />
            {agentRunning ? "RUNNING" : "READY"}
          </div>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">

          {/* Left: Task input + messages */}
          <Panel defaultSize={28} minSize={20}>
            <div className="h-full flex flex-col border-r border-border">
              <div className="px-3 py-2 border-b border-border bg-zinc-950/50 shrink-0">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Task Input</p>
              </div>

              {/* Quick tasks */}
              <div className="px-3 py-2 border-b border-border/50 shrink-0">
                <p className="text-[10px] text-zinc-600 mb-1.5">Quick tasks:</p>
                <div className="flex flex-wrap gap-1">
                  {QUICK_TASKS.map(qt => (
                    <button
                      key={qt.label}
                      onClick={() => setTaskInput(qt.prompt)}
                      className="text-[10px] px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 text-zinc-400 rounded hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      {qt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message history */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {agentMessages.length === 0 && (
                  <div className="text-center py-8">
                    <Zap size={24} className="mx-auto mb-2 text-zinc-700" />
                    <p className="text-xs text-zinc-600">Enter a task and MAVIS will reason through it autonomously.</p>
                  </div>
                )}
                {agentMessages.map(msg => (
                  <div key={msg.id} className={`text-xs ${msg.role === "user" ? "text-zinc-400" : "text-zinc-200"}`}>
                    <div className={`text-[10px] font-mono mb-1 ${msg.role === "user" ? "text-zinc-600" : "text-primary"}`}>
                      {msg.role === "user" ? "▸ YOU" : "▸ MAVIS"}
                    </div>
                    {msg.content ? (
                      <div className="prose prose-invert prose-xs max-w-none leading-relaxed">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="text-zinc-600 animate-pulse text-[10px]">thinking...</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Task input */}
              <div className="p-3 border-t border-border shrink-0">
                <textarea
                  value={taskInput}
                  onChange={e => setTaskInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && e.metaKey) { e.preventDefault(); runTask(); } }}
                  placeholder="Describe what you want the agent to do... (⌘+Enter to run)"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-xs text-zinc-200 font-mono resize-none outline-none placeholder:text-zinc-600 focus:border-primary/50 min-h-[80px] max-h-[140px]"
                  rows={4}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={runTask}
                    disabled={agentRunning || !taskInput.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs bg-primary/20 border border-primary/40 text-primary rounded-lg hover:bg-primary/30 disabled:opacity-40"
                  >
                    {agentRunning ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    {agentRunning ? "Running..." : "Run Task"}
                  </button>
                  {agentRunning && (
                    <button
                      onClick={stopAgent}
                      className="px-3 py-1.5 text-xs bg-red-500/20 border border-red-500/40 text-red-400 rounded-lg hover:bg-red-500/30"
                    >
                      <Square size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => setAgentMessages([])}
                    className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded-lg border border-zinc-800"
                    title="Clear history"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/30 transition-colors cursor-col-resize" />

          {/* Center: Agent step feed */}
          <Panel defaultSize={30} minSize={20}>
            <div className="h-full flex flex-col border-r border-border">
              <div className="px-3 py-2 border-b border-border bg-zinc-950/50 shrink-0 flex items-center justify-between">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Agent Feed</p>
                <span className="text-[10px] text-zinc-600">{agentMessages.filter(m => m.role === "agent").reduce((acc, m) => acc + m.steps.length, 0)} steps</span>
              </div>

              <div ref={feedRef} className="flex-1 overflow-y-auto p-3 space-y-2">
                {agentMessages.filter(m => m.role === "agent" && m.steps.length > 0).map(msg => (
                  <div key={msg.id} className="space-y-1.5">
                    {msg.steps.map(step => (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`flex items-start gap-2 text-[11px] p-2 rounded-lg border ${
                          step.type === "thinking" ? "border-primary/20 bg-primary/5" :
                          step.type === "tool_call" ? "border-cyan-500/20 bg-cyan-500/5" :
                          step.type === "result" ? "border-emerald-500/20 bg-emerald-500/5" :
                          "border-red-500/20 bg-red-500/5"
                        }`}
                      >
                        <div className="shrink-0 mt-0.5">
                          {step.type === "thinking" && <Loader2 size={11} className="animate-spin text-primary" />}
                          {step.type === "tool_call" && <Zap size={11} className="text-cyan-400" />}
                          {step.type === "result" && <CheckCircle2 size={11} className="text-emerald-400" />}
                          {step.type === "error" && <XCircle size={11} className="text-red-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-mono font-medium ${
                            step.type === "thinking" ? "text-primary" :
                            step.type === "tool_call" ? "text-cyan-400" :
                            step.type === "result" ? "text-emerald-400" : "text-red-400"
                          }`}>{step.label}</p>
                          {step.detail && (
                            <p className="text-zinc-500 text-[10px] truncate mt-0.5">{step.detail}</p>
                          )}
                        </div>
                        <span className="text-[9px] text-zinc-700 shrink-0">
                          {step.ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                ))}
                {agentMessages.every(m => m.role === "user" || m.steps.length === 0) && (
                  <div className="text-center py-8">
                    <ChevronRight size={20} className="mx-auto mb-2 text-zinc-700" />
                    <p className="text-xs text-zinc-600">Agent reasoning steps will appear here.</p>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/30 transition-colors cursor-col-resize" />

          {/* Right: Multi-terminal */}
          <Panel defaultSize={42} minSize={25}>
            <div className="h-full flex flex-col">
              {/* Terminal tabs */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-zinc-950/50 shrink-0 overflow-x-auto">
                {terminals.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTerminal(t.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono rounded-lg border whitespace-nowrap transition-colors ${
                      activeTerminal === t.id
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-zinc-700/50 text-zinc-500 hover:border-zinc-600"
                    }`}
                  >
                    <Terminal size={9} />
                    <span className={LANG_COLORS[t.language]}>{LANG_LABELS[t.language]}</span>
                    {t.running && <Loader2 size={8} className="animate-spin" />}
                  </button>
                ))}
                <button
                  onClick={addTerminal}
                  className="p-1.5 text-zinc-600 hover:text-primary border border-zinc-700/50 rounded-lg hover:border-primary/40 transition-colors shrink-0"
                  title="New terminal"
                >
                  <Plus size={11} />
                </button>
                {/* Language switcher for active terminal */}
                {terminals.find(t => t.id === activeTerminal) && (
                  <div className="ml-auto flex items-center gap-1">
                    {(["python", "node", "typescript", "bash"] as const).map(lang => (
                      <button
                        key={lang}
                        onClick={() => changeTerminalLang(activeTerminal, lang)}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                          terminals.find(t => t.id === activeTerminal)?.language === lang
                            ? `border-primary/40 bg-primary/10 ${LANG_COLORS[lang]}`
                            : "border-zinc-700/50 text-zinc-600 hover:border-zinc-600"
                        }`}
                      >
                        {lang === "node" ? "JS" : lang === "typescript" ? "TS" : lang === "bash" ? "SH" : "PY"}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Terminal display */}
              <div className="flex-1 overflow-hidden">
                {terminals.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <Terminal size={28} className="mx-auto mb-2 text-zinc-700" />
                      <p className="text-xs text-zinc-600">No terminals open.</p>
                      <button onClick={addTerminal} className="mt-2 text-xs text-primary hover:underline">
                        Open one
                      </button>
                    </div>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    {terminals.map(t => t.id === activeTerminal ? (
                      <motion.div
                        key={t.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="h-full"
                      >
                        <TerminalPanel
                          session={t}
                          onRun={(code, lang) => runInTerminal(t.id, code, lang)}
                          onClear={() => clearTerminal(t.id)}
                          onClose={() => closeTerminal(t.id)}
                          isActive={activeTerminal === t.id}
                          onActivate={() => setActiveTerminal(t.id)}
                        />
                      </motion.div>
                    ) : null)}
                  </AnimatePresence>
                )}
              </div>
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  );
}
