// ============================================================
// VANTARA.EXE — Agent Console v2
// Wires mavis-terminal (E2B), mavis-crew-orchestrator,
// mavis-browser-agent, and mavis-self-evolve into one UI.
// ============================================================
import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Square, Plus, X, Loader2, Terminal,
  CheckCircle2, XCircle, Zap, Globe, GitBranch,
  Trash2, Copy, Check, RotateCcw, Brain, Users,
  ChevronRight, Clock, TrendingUp, Sparkles,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";

const supabase = _supabase as any;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

// ── Types ────────────────────────────────────────────────────

type ConsoleMode = "single" | "crew" | "browser";

type AgentStep = {
  id: string;
  role?: string;
  type: "thinking" | "tool_call" | "result" | "error" | "agent" | "browse";
  label: string;
  detail?: string;
  ts: Date;
  output?: string;
  success?: boolean;
  duration_ms?: number;
};

type TermSession = {
  id: string;            // UI tab ID
  e2bId?: string;        // mavis-terminal session_id
  label: string;
  entries: TermEntry[];
  running: boolean;
  cwd: string;
};

type TermEntry = {
  id: string;
  type: "input" | "stdout" | "stderr" | "error" | "info";
  text: string;
};

type AgentMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  steps: AgentStep[];
  ts: Date;
  mode: ConsoleMode;
};

const MODE_META: Record<ConsoleMode, { label: string; icon: any; color: string; desc: string }> = {
  single: { label: "SINGLE", icon: Brain,  color: "text-primary",     desc: "mavis-agent — direct task execution" },
  crew:   { label: "CREW",   icon: Users,  color: "text-cyan-400",    desc: "mavis-crew-orchestrator — parallel specialists" },
  browser:{ label: "BROWSER",icon: Globe,  color: "text-emerald-400", desc: "mavis-browser-agent — autonomous web research" },
};

const QUICK_TASKS: Record<ConsoleMode, { label: string; prompt: string }[]> = {
  single: [
    { label: "Code review",     prompt: "Perform a thorough code review of the MAVIS system focusing on security, correctness, and performance." },
    { label: "Architecture",    prompt: "Analyze the overall architecture of this application and identify potential improvements." },
    { label: "Security audit",  prompt: "Run a security audit: check for injection vulnerabilities, auth issues, and data exposure risks." },
    { label: "Optimize perf",   prompt: "Identify the top performance bottlenecks in the React frontend and propose optimizations." },
    { label: "Test coverage",   prompt: "Analyze what areas of the codebase lack test coverage and propose unit tests." },
    { label: "Git status",      prompt: "Summarize recent git activity: what changed, what patterns emerge, and what needs attention." },
  ],
  crew: [
    { label: "Full system audit", prompt: "Run a comprehensive audit of the entire application: architecture, security, performance, UX, and business logic." },
    { label: "Product strategy",  prompt: "Analyze the current product state and propose a 90-day roadmap to make it market-ready." },
    { label: "Competitive intel", prompt: "Research the competitive landscape for AI agent platforms and identify differentiation opportunities." },
    { label: "Growth strategy",   prompt: "Develop a growth strategy for VANTARA.EXE including acquisition, retention, and monetization." },
  ],
  browser: [
    { label: "Research topic",  prompt: "Research the latest developments in AI agent frameworks and autonomous coding tools." },
    { label: "Find libraries",  prompt: "Find the best open-source libraries for building autonomous coding agents with multi-language support." },
    { label: "Market research", prompt: "Research the current market for AI-powered development tools and identify pricing benchmarks." },
    { label: "Tech docs",       prompt: "Find comprehensive documentation for the Tauri framework and its desktop app capabilities." },
  ],
};

// ── Swarm preset workflows (map to backend TASK_TYPE_PRESETS) ─────────────────
const SWARM_PRESETS = [
  { key: "permit_roadmap",   label: "Permit Roadmap",    desc: "PLANNER + RESEARCHER + RISK + NARRATIVE" },
  { key: "company_analysis", label: "Company Analysis",  desc: "RESEARCHER + ANALYST + CRITIC + PLANNER" },
  { key: "content_strategy", label: "Content Strategy",  desc: "RESEARCHER + ANALYST + EXECUTOR + CRITIC" },
  { key: "risk_assessment",  label: "Risk Assessment",   desc: "RESEARCHER + ANALYST + PLANNER + CRITIC" },
] as const;

// ── Terminal session panel ────────────────────────────────────

function TerminalPanel({
  session,
  onRun,
  onClear,
  onClose,
  isActive,
  onActivate,
}: {
  session: TermSession;
  onRun: (code: string) => void;
  onClear: () => void;
  onClose: () => void;
  isActive: boolean;
  onActivate: () => void;
}) {
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [session.entries]);

  const run = () => {
    if (!input.trim() || session.running) return;
    onRun(input.trim());
    setInput("");
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(session.entries.map(e => e.text).join("\n")).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`flex flex-col h-full border rounded-lg overflow-hidden transition-colors ${isActive ? "border-primary/40" : "border-zinc-700/50"}`} onClick={onActivate}>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className={`w-2 h-2 rounded-full ${session.running ? "bg-yellow-400 animate-pulse" : session.e2bId ? "bg-emerald-400" : "bg-zinc-500"}`} />
        <Terminal size={10} className="text-zinc-500" />
        <span className="text-[10px] text-zinc-400 truncate flex-1">{session.label}</span>
        {session.e2bId && <span className="text-[9px] text-cyan-600">E2B</span>}
        {session.cwd && session.cwd !== "/" && (
          <span className="text-[9px] text-zinc-600 truncate max-w-[80px]">{session.cwd}</span>
        )}
        <button onClick={copyOutput} className="text-zinc-600 hover:text-zinc-300 p-0.5">{copied ? <Check size={10}/> : <Copy size={10}/>}</button>
        <button onClick={onClear}   className="text-zinc-600 hover:text-zinc-300 p-0.5"><Trash2 size={10}/></button>
        <button onClick={onClose}   className="text-zinc-600 hover:text-red-400 p-0.5"><X size={10}/></button>
      </div>
      <div ref={outputRef} className="flex-1 overflow-y-auto p-2.5 bg-black/50 font-mono text-[11px] leading-relaxed space-y-0.5">
        {session.entries.length === 0 && <p className="text-zinc-600 italic">Shell ready — type a command and press Enter.</p>}
        {session.entries.map(e => (
          <div key={e.id} className={
            e.type === "input"  ? "text-cyan-400" :
            e.type === "stdout" ? "text-zinc-200" :
            e.type === "stderr" ? "text-yellow-400" :
            e.type === "error"  ? "text-red-400" : "text-zinc-500 italic"
          }>{e.type === "input" ? `$ ${e.text}` : e.text}</div>
        ))}
        {session.running && <div className="text-zinc-500 flex items-center gap-1"><Loader2 size={9} className="animate-spin"/> running...</div>}
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5 bg-zinc-900 border-t border-zinc-800 shrink-0">
        <span className="text-zinc-500 font-mono text-xs">$</span>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }}}
          placeholder="bash command... (Enter to run)"
          className="flex-1 bg-transparent text-xs font-mono text-zinc-200 resize-none outline-none placeholder:text-zinc-600 min-h-[18px] max-h-[60px]"
          rows={1}
        />
        <button onClick={run} disabled={session.running || !input.trim()} className="p-1 text-zinc-500 hover:text-primary disabled:opacity-30">
          {session.running ? <Loader2 size={11} className="animate-spin"/> : <Send size={11}/>}
        </button>
      </div>
    </div>
  );
}

// ── Crew agent card ──────────────────────────────────────────

function CrewAgentCard({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);
  const roleIcon: Record<string, string> = { researcher: "🔬", analyst: "📊", planner: "🗺", critic: "⚖️", executor: "⚡", synthesizer: "🧬", validator: "✅" };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-2.5 rounded-lg border text-[11px] cursor-pointer ${
        step.success === false ? "border-red-500/20 bg-red-500/5" :
        step.type === "result"  ? "border-emerald-500/20 bg-emerald-500/5" :
                                  "border-cyan-500/20 bg-cyan-500/5"
      }`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-center gap-2">
        <span className="text-base">{roleIcon[step.role ?? ""] ?? "🤖"}</span>
        <div className="flex-1 min-w-0">
          <p className="font-mono font-medium text-zinc-200 capitalize">{step.role ?? step.label}</p>
          <p className="text-zinc-500 text-[10px] truncate">{step.detail}</p>
        </div>
        {step.duration_ms && <span className="text-zinc-600 text-[9px] shrink-0">{(step.duration_ms / 1000).toFixed(1)}s</span>}
        {step.success !== undefined && (
          step.success ? <CheckCircle2 size={11} className="text-emerald-400 shrink-0"/> : <XCircle size={11} className="text-red-400 shrink-0"/>
        )}
      </div>
      {expanded && step.output && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50 text-foreground prose dark:prose-invert prose-xs max-w-none">
          <ReactMarkdown>{step.output.slice(0, 1500)}</ReactMarkdown>
        </div>
      )}
    </motion.div>
  );
}

// ── Main AgentConsole ─────────────────────────────────────────

export function AgentConsole() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const userId = session?.user?.id ?? "";

  const [mode, setMode] = useState<ConsoleMode>("single");
  const [taskInput, setTaskInput] = useState("");
  const [swarmPreset, setSwarmPreset] = useState<string>("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [evolving, setEvolving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Terminals
  const [terminals, setTerminals] = useState<TermSession[]>([
    { id: "t1", label: "Shell 1", entries: [], running: false, cwd: "~" },
  ]);
  const [activeTerminal, setActiveTerminal] = useState("t1");

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [agentMessages]);

  // ── invoke helper ───────────────────────────────────────────
  async function invoke(fn: string, body: object) {
    const res = await fetch(`${SB_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data;
  }

  // ── Run task ────────────────────────────────────────────────
  const runTask = useCallback(async () => {
    const task = taskInput.trim();
    if (!task || agentRunning) return;
    setTaskInput("");
    setAgentRunning(true);
    abortRef.current = new AbortController();

    const userMsg: AgentMessage = { id: `u-${Date.now()}`, role: "user", content: task, steps: [], ts: new Date(), mode };
    const agentId = `am-${Date.now()}`;
    const agentMsg: AgentMessage = { id: agentId, role: "agent", content: "", steps: [], ts: new Date(), mode };
    setAgentMessages(prev => [...prev, userMsg, agentMsg]);

    const addStep = (step: Omit<AgentStep, "id">) => {
      setAgentMessages(prev => prev.map(m =>
        m.id === agentId ? { ...m, steps: [...m.steps, { ...step, id: `s-${Date.now()}-${Math.random()}` }] } : m
      ));
    };
    const setContent = (content: string) => {
      setAgentMessages(prev => prev.map(m => m.id === agentId ? { ...m, content } : m));
    };

    try {
      if (mode === "single") {
        addStep({ type: "thinking", label: "Routing to MAVIS Agent...", ts: new Date() });
        const data = await invoke("mavis-agent", { goal: task, userId, messages: [] });
        const content = data?.content ?? data?.response ?? data?.result ?? JSON.stringify(data);
        const toolsUsed: string[] = data?.toolsUsed ?? data?.tools_used ?? [];
        toolsUsed.forEach(t => addStep({ type: "tool_call", label: t, detail: `Tool: ${t}`, ts: new Date() }));
        addStep({ type: "result", label: "Complete", detail: `${content.length} chars`, ts: new Date() });
        setContent(content);
      }

      else if (mode === "crew") {
        const hasPreset = Boolean(swarmPreset);
        addStep({
          type: "thinking",
          label: hasPreset ? `Running ${swarmPreset} preset swarm…` : "PLANNER decomposing goal into specialist tasks…",
          ts: new Date(),
        });
        const t0 = Date.now();
        const body: Record<string, any> = { goal: task, max_agents: 5 };
        if (hasPreset) { body.task_type = swarmPreset; body.input = { _goal: task }; }
        const data = await invoke("mavis-crew-orchestrator", body);
        const agents: any[] = data.agents ?? [];
        agents.forEach(a => {
          addStep({
            type: a.success ? "agent" : "error",
            role: a.role,
            label: a.role ?? "agent",
            detail: a.task,
            output: a.output,
            success: a.success,
            duration_ms: a.duration_ms,
            ts: new Date(),
          });
        });
        // Show validator result
        const v = data.validation;
        if (v) {
          addStep({
            type: v.approved ? "result" : "error",
            role: "validator",
            label: `VALIDATOR — ${v.approved ? "✅ APPROVED" : "⚠️ NEEDS WORK"} · Score ${v.score}/10`,
            detail: v.suggestions?.join(" · ") ?? "",
            output: v.suggestions?.length ? v.suggestions.map((s: string) => `• ${s}`).join("\n") : "No suggestions.",
            success: v.approved,
            ts: new Date(),
          });
        }
        addStep({
          type: "result",
          label: `Swarm complete`,
          detail: `${agents.length} agents · ${((Date.now()-t0)/1000).toFixed(1)}s${hasPreset ? ` · ${swarmPreset}` : ""}`,
          ts: new Date(),
        });
        setContent(data.synthesis ?? JSON.stringify(data));
      }

      else if (mode === "browser") {
        addStep({ type: "browse", label: "Starting browser agent...", detail: task, ts: new Date() });
        const data = await invoke("mavis-browser-agent", { goal: task, max_turns: 6 });
        if (data.status === "completed" || data.result) {
          addStep({ type: "result", label: `Done in ${data.steps_taken ?? "?"} turns`, ts: new Date() });
          setContent(data.result ?? JSON.stringify(data));
        } else {
          addStep({ type: "thinking", label: `Running (${data.steps_taken ?? 0} turns)...`, ts: new Date() });
          setContent(`Browser session: ${data.session_id}\nStatus: ${data.status}\nSteps: ${data.steps_taken}`);
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const errMsg = err?.message ?? "Agent task failed";
      addStep({ type: "error", label: "Error", detail: errMsg, ts: new Date() });
      setContent(`**Error:** ${errMsg}`);
      toast.error(errMsg);
    } finally {
      setAgentRunning(false);
    }
  }, [taskInput, agentRunning, token, session, mode]);

  // ── Execute in terminal (mavis-terminal via E2B) ────────────
  const runInTerminal = useCallback(async (termId: string, command: string) => {
    setTerminals(prev => prev.map(t =>
      t.id === termId ? { ...t, running: true, entries: [...t.entries, { id: `e-${Date.now()}`, type: "input", text: command }] } : t
    ));

    const term = terminals.find(t => t.id === termId)!;

    const addEntries = (entries: { type: TermEntry["type"]; text: string }[]) => {
      setTerminals(prev => prev.map(t =>
        t.id === termId ? {
          ...t,
          running: false,
          entries: [...t.entries, ...entries.map((e, i) => ({ id: `e-${Date.now()}-${i}`, ...e }))],
        } : t
      ));
    };

    const updateCwd = (cwd: string, e2bId?: string) => {
      setTerminals(prev => prev.map(t =>
        t.id === termId ? { ...t, cwd: cwd || t.cwd, e2bId: e2bId ?? t.e2bId } : t
      ));
    };

    try {
      const data = await invoke("mavis-terminal", {
        action: "exec",
        command,
        session_id: term.e2bId,
        timeout: 30,
      });

      const entries: { type: TermEntry["type"]; text: string }[] = [];
      if (data.output) {
        data.output.split("\n").forEach((line: string) => {
          if (line) entries.push({ type: "stdout", text: line });
        });
      }
      if (!data.output) entries.push({ type: "info", text: "(no output)" });
      if (data.exit_code !== 0) entries.push({ type: "info", text: `exit ${data.exit_code}` });
      addEntries(entries);
      if (data.cwd) updateCwd(data.cwd, data.session_id);
    } catch (err: any) {
      // mavis-terminal not available (no E2B key) — fall back to mavis-code-exec
      try {
        const isShell = !command.startsWith("python") && !command.startsWith("node");
        const res = await fetch(`${SB_URL}/functions/v1/mavis-code-exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code: command, language: "bash" }),
        });
        const data = await res.json().catch(() => ({}));
        const entries: { type: TermEntry["type"]; text: string }[] = [];
        if (data.output) data.output.forEach((line: string) => entries.push({ type: "stdout", text: line }));
        if (data.result) entries.push({ type: "stdout", text: data.result });
        if (data.error) entries.push({ type: "error", text: data.error });
        if (entries.length === 0) entries.push({ type: "info", text: "(no output)" });
        addEntries(entries);
      } catch {
        addEntries([{ type: "error", text: err?.message ?? "Execution failed" }]);
      }
    }
  }, [terminals, token]);

  // ── Add terminal ─────────────────────────────────────────────
  const addTerminal = () => {
    const id = `t-${Date.now()}`;
    setTerminals(prev => [...prev, { id, label: `Shell ${prev.length + 1}`, entries: [], running: false, cwd: "~" }]);
    setActiveTerminal(id);
  };

  // ── Self-evolve trigger ──────────────────────────────────────
  const triggerSelfEvolve = async () => {
    if (!userId || evolving) return;
    setEvolving(true);
    try {
      const data = await invoke("mavis-self-evolve", { user_id: userId });
      toast.success(`Evolution complete — ${data.rules_strengthened ?? 0} strengthened, ${data.rules_added ?? 0} added, ${data.rules_pruned ?? 0} pruned`);
    } catch (err: any) {
      toast.error(`Self-evolve: ${err?.message ?? "failed"}`);
    } finally {
      setEvolving(false);
    }
  };

  const stopAgent = () => { abortRef.current?.abort(); setAgentRunning(false); };
  const quickTasks = QUICK_TASKS[mode];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background font-mono">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-zinc-950 shrink-0">
        <div className="w-7 h-7 rounded bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Terminal size={13} className="text-primary" />
        </div>
        <div>
          <h1 className="text-[11px] font-display font-bold text-primary tracking-widest">AGENT CONSOLE</h1>
          <p className="text-[9px] text-zinc-600">VANTARA autonomous AI agent platform</p>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-1 ml-4">
          {(["single", "crew", "browser"] as ConsoleMode[]).map(m => {
            const meta = MODE_META[m];
            const Icon = meta.icon;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                title={meta.desc}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono rounded-lg border transition-colors ${
                  mode === m ? `border-primary/40 bg-primary/10 ${meta.color}` : "border-zinc-700/50 text-zinc-500 hover:border-zinc-600"
                }`}
              >
                <Icon size={10} />
                {meta.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={triggerSelfEvolve}
            disabled={evolving}
            title="Trigger weekly self-improvement cycle"
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg border border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-50"
          >
            {evolving ? <Loader2 size={10} className="animate-spin"/> : <Sparkles size={10}/>}
            EVOLVE
          </button>
          <div className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border ${agentRunning ? "border-yellow-500/30 text-yellow-400 bg-yellow-500/10" : "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${agentRunning ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`} />
            {agentRunning ? "RUNNING" : "READY"}
          </div>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup {...({ direction: "horizontal" } as any)}>

          {/* Left: Input + history */}
          <Panel defaultSize={28} minSize={18}>
            <div className="h-full flex flex-col border-r border-border">
              <div className="px-3 py-2 border-b border-border bg-zinc-950/50 shrink-0 flex items-center justify-between">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">{MODE_META[mode].label} MODE</p>
                <p className="text-[9px] text-zinc-700">{MODE_META[mode].desc}</p>
              </div>

              {/* Quick tasks */}
              <div className="px-3 py-2 border-b border-border/50 shrink-0">
                <div className="flex flex-wrap gap-1">
                  {quickTasks.map(qt => (
                    <button key={qt.label} onClick={() => setTaskInput(qt.prompt)}
                      className="text-[9px] px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 text-zinc-400 rounded hover:border-primary/40 hover:text-primary transition-colors">
                      {qt.label}
                    </button>
                  ))}
                </div>
                {/* Swarm preset selector — only shown in CREW mode */}
                {mode === "crew" && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[9px] text-zinc-600 font-mono">PRESET:</span>
                    <button
                      onClick={() => setSwarmPreset("")}
                      className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${!swarmPreset ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}
                    >auto</button>
                    {SWARM_PRESETS.map(p => (
                      <button key={p.key}
                        onClick={() => setSwarmPreset(swarmPreset === p.key ? "" : p.key)}
                        title={p.desc}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${swarmPreset === p.key ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300" : "border-zinc-700 text-zinc-500 hover:text-zinc-300"}`}
                      >{p.label}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* Message history */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {agentMessages.length === 0 && (
                  <div className="text-center py-8">
                    <Zap size={20} className="mx-auto mb-2 text-zinc-700" />
                    <p className="text-xs text-zinc-600">
                      {mode === "single" && "Single MAVIS agent — fast, direct task execution."}
                      {mode === "crew"   && "Crew mode — 5 parallel specialists synthesized into one answer."}
                      {mode === "browser"&& "Browser agent — autonomous multi-turn web research."}
                    </p>
                  </div>
                )}
                {agentMessages.map(msg => (
                  <div key={msg.id} className="text-xs">
                    <div className={`text-[10px] font-mono mb-1 ${msg.role === "user" ? "text-zinc-600" : `${MODE_META[msg.mode].color}`}`}>
                      {msg.role === "user" ? "▸ YOU" : `▸ ${MODE_META[msg.mode].label}`}
                    </div>
                    {msg.content ? (
                      <div className="prose dark:prose-invert prose-xs max-w-none leading-relaxed text-foreground">
                        <ReactMarkdown>{msg.content.slice(0, 3000)}</ReactMarkdown>
                        {msg.content.length > 3000 && <p className="text-zinc-600 text-[10px]">…truncated</p>}
                      </div>
                    ) : msg.role === "agent" ? (
                      <div className="text-zinc-600 animate-pulse text-[10px]">processing...</div>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Input */}
              <div className="p-3 border-t border-border shrink-0">
                <textarea
                  value={taskInput}
                  onChange={e => setTaskInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && e.metaKey) { e.preventDefault(); runTask(); } }}
                  placeholder={mode === "single" ? "Task for MAVIS agent... (⌘+Enter)" : mode === "crew" ? "Complex goal for crew... (⌘+Enter)" : "Research goal for browser agent... (⌘+Enter)"}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-xs text-zinc-200 font-mono resize-none outline-none placeholder:text-zinc-600 focus:border-primary/50 min-h-[70px] max-h-[130px]"
                  rows={3}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={runTask} disabled={agentRunning || !taskInput.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs bg-primary/20 border border-primary/40 text-primary rounded-lg hover:bg-primary/30 disabled:opacity-40">
                    {agentRunning ? <Loader2 size={12} className="animate-spin"/> : <Zap size={12}/>}
                    {agentRunning ? "Running..." : "Run"}
                  </button>
                  {agentRunning && (
                    <button onClick={stopAgent} className="px-3 py-1.5 text-xs bg-red-500/20 border border-red-500/40 text-red-400 rounded-lg hover:bg-red-500/30">
                      <Square size={12}/>
                    </button>
                  )}
                  <button onClick={() => setAgentMessages([])} className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded-lg border border-zinc-800" title="Clear history">
                    <RotateCcw size={12}/>
                  </button>
                </div>
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/30 transition-colors cursor-col-resize" />

          {/* Center: Agent feed */}
          <Panel defaultSize={30} minSize={18}>
            <div className="h-full flex flex-col border-r border-border">
              <div className="px-3 py-2 border-b border-border bg-zinc-950/50 shrink-0 flex items-center justify-between">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Agent Feed</p>
                <span className="text-[10px] text-zinc-600">
                  {agentMessages.filter(m => m.role === "agent").reduce((a, m) => a + m.steps.length, 0)} steps
                </span>
              </div>

              <div ref={feedRef} className="flex-1 overflow-y-auto p-3 space-y-2">
                {agentMessages.filter(m => m.role === "agent" && m.steps.length > 0).map(msg => (
                  <div key={msg.id} className="space-y-1.5">
                    {msg.steps.map(step => (
                      step.type === "agent" ? (
                        <CrewAgentCard key={step.id} step={step} />
                      ) : (
                        <motion.div
                          key={step.id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`flex items-start gap-2 text-[11px] p-2 rounded-lg border ${
                            step.type === "thinking" ? "border-primary/20 bg-primary/5" :
                            step.type === "tool_call" ? "border-cyan-500/20 bg-cyan-500/5" :
                            step.type === "browse"    ? "border-emerald-500/20 bg-emerald-500/5" :
                            step.type === "result"    ? "border-violet-500/20 bg-violet-500/5" :
                            "border-red-500/20 bg-red-500/5"
                          }`}
                        >
                          <div className="shrink-0 mt-0.5">
                            {step.type === "thinking" && <Loader2 size={11} className="animate-spin text-primary"/>}
                            {step.type === "tool_call" && <Zap size={11} className="text-cyan-400"/>}
                            {step.type === "browse"    && <Globe size={11} className="text-emerald-400"/>}
                            {step.type === "result"    && <CheckCircle2 size={11} className="text-violet-400"/>}
                            {step.type === "error"     && <XCircle size={11} className="text-red-400"/>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-mono font-medium ${
                              step.type === "thinking" ? "text-primary" :
                              step.type === "tool_call" ? "text-cyan-400" :
                              step.type === "browse"    ? "text-emerald-400" :
                              step.type === "result"    ? "text-violet-400" : "text-red-400"
                            }`}>{step.label}</p>
                            {step.detail && <p className="text-zinc-500 text-[10px] truncate mt-0.5">{step.detail}</p>}
                          </div>
                          <span className="text-[9px] text-zinc-700 shrink-0">
                            {step.ts.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </motion.div>
                      )
                    ))}
                  </div>
                ))}
                {agentMessages.every(m => m.role === "user" || m.steps.length === 0) && (
                  <div className="text-center py-8">
                    <ChevronRight size={18} className="mx-auto mb-2 text-zinc-700"/>
                    <p className="text-xs text-zinc-600">Agent reasoning steps appear here in real-time.</p>
                    {mode === "crew" && <p className="text-[10px] text-zinc-700 mt-1">Crew mode shows all 5 specialist outputs.</p>}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/30 transition-colors cursor-col-resize" />

          {/* Right: Terminals */}
          <Panel defaultSize={42} minSize={22}>
            <div className="h-full flex flex-col">
              {/* Tab bar */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-zinc-950/50 shrink-0 overflow-x-auto">
                {terminals.map(t => (
                  <button key={t.id} onClick={() => setActiveTerminal(t.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono rounded border whitespace-nowrap transition-colors ${
                      activeTerminal === t.id ? "border-primary/40 bg-primary/10 text-primary" : "border-zinc-700/50 text-zinc-500 hover:border-zinc-600"
                    }`}
                  >
                    <Terminal size={9}/>
                    {t.label}
                    {t.e2bId && <span className="text-[8px] text-cyan-600">E2B</span>}
                    {t.running && <Loader2 size={8} className="animate-spin"/>}
                  </button>
                ))}
                <button onClick={addTerminal} className="p-1 text-zinc-600 hover:text-primary border border-zinc-700/50 rounded hover:border-primary/40 transition-colors shrink-0" title="New terminal">
                  <Plus size={10}/>
                </button>
              </div>

              {/* Active terminal */}
              <div className="flex-1 overflow-hidden p-2">
                <AnimatePresence mode="wait">
                  {terminals.map(t => t.id === activeTerminal ? (
                    <motion.div key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                      <TerminalPanel
                        session={t}
                        onRun={cmd => runInTerminal(t.id, cmd)}
                        onClear={() => setTerminals(prev => prev.map(s => s.id === t.id ? { ...s, entries: [] } : s))}
                        onClose={() => {
                          setTerminals(prev => prev.filter(s => s.id !== t.id));
                          if (activeTerminal === t.id) setActiveTerminal(terminals.find(s => s.id !== t.id)?.id ?? "");
                        }}
                        isActive
                        onActivate={() => {}}
                      />
                    </motion.div>
                  ) : null)}
                </AnimatePresence>
                {terminals.length === 0 && (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <Terminal size={24} className="mx-auto mb-2 text-zinc-700"/>
                      <p className="text-xs text-zinc-600 mb-2">No terminals open.</p>
                      <button onClick={addTerminal} className="text-xs text-primary hover:underline">Open one →</button>
                    </div>
                  </div>
                )}
              </div>

              {/* E2B status note */}
              <div className="px-3 py-1 border-t border-border/50 shrink-0">
                <p className="text-[9px] text-zinc-700">Terminals use <span className="text-cyan-700">mavis-terminal</span> (E2B cloud sessions) · requires E2B_API_KEY secret</p>
              </div>
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  );
}
