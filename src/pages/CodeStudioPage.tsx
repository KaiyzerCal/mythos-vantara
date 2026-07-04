// ============================================================
// VANTARA.EXE — Code Studio
// CodeMirror 6 editor + MAVIS code intelligence + sandboxed
// execution + GitHub repo analysis via mavis-code-agent
// ============================================================
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play, Square, Loader2, Github, ChevronRight,
  Copy, Check, Trash2, TerminalSquare, Sparkles,
  RefreshCw, Bug, FileCode, Wand2, BookOpen, AlertTriangle,
  MessageSquare, ExternalLink, Send,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

// CodeMirror 6 — core
import { EditorView, lineNumbers, highlightActiveLine, keymap, drawSelection, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";

const supabase = _supabase as any;

// ── Language config ──────────────────────────────────────────
const LANGS = [
  { id: "javascript", label: "JavaScript",  ext: "js",  cm: () => javascript({ jsx: false }) },
  { id: "typescript", label: "TypeScript",  ext: "ts",  cm: () => javascript({ typescript: true }) },
  { id: "python",     label: "Python",      ext: "py",  cm: () => null },
  { id: "html",       label: "HTML",        ext: "html", cm: () => html() },
  { id: "css",        label: "CSS",         ext: "css",  cm: () => css() },
  { id: "bash",       label: "Bash",        ext: "sh",   cm: () => null },
] as const;

type LangId = (typeof LANGS)[number]["id"];

// ── Mavis action buttons ─────────────────────────────────────
const AI_ACTIONS = [
  { id: "analyze",  label: "Analyze",  icon: Sparkles,   prompt: "Perform a senior-level code analysis. Identify patterns, architectural decisions, and overall code quality." },
  { id: "explain",  label: "Explain",  icon: BookOpen,   prompt: "Explain this code clearly, line by line if needed. Include what it does, how it works, and why key decisions were made." },
  { id: "debug",    label: "Debug",    icon: Bug,        prompt: "Find all bugs, edge cases, and potential runtime errors. Show exact line numbers and provide corrected code." },
  { id: "refactor", label: "Refactor", icon: Wand2,      prompt: "Refactor this code for better readability, performance, and maintainability. Apply SOLID principles where relevant." },
  { id: "review",   label: "Review",   icon: FileCode,   prompt: "Do a thorough code review as a staff engineer at a Mag7 company. Security, performance, correctness, style." },
  { id: "test",     label: "Generate Tests", icon: CheckSquare, prompt: "Write comprehensive unit tests for this code. Cover happy path, edge cases, and error states." },
] as const;

// CheckSquare isn't imported — use a workaround
function CheckSquare({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

type OutputLine = { type: "stdout" | "stderr" | "info" | "error"; text: string };
type MavisPanel = "output" | "mavis" | "github";

const PLACEHOLDER_CODE: Record<LangId, string> = {
  javascript: `// Write JavaScript here — Mavis can run, analyze, or review it
function greet(name) {
  return \`Hello, \${name}! Ready to ship.\`;
}
console.log(greet("Vantara"));
`,
  typescript: `// TypeScript — Mavis understands types deeply
interface User {
  id: string;
  name: string;
  role: "operator" | "agent";
}

function formatUser(user: User): string {
  return \`[\${user.role.toUpperCase()}] \${user.name}\`;
}
`,
  python: `# Python — powered by the MAVIS sandbox
import json
from datetime import datetime

data = {"timestamp": datetime.now().isoformat(), "status": "operational"}
print(json.dumps(data, indent=2))
`,
  html: `<!DOCTYPE html>
<html>
<head>
  <title>VANTARA Preview</title>
  <style>
    body { background: #0a0d1f; color: #e2e8f0; font-family: monospace; }
    h1 { color: #7c3aed; }
  </style>
</head>
<body>
  <h1>MAVIS Code Studio</h1>
  <p>Edit and preview HTML live.</p>
</body>
</html>
`,
  css: `/* Paste your CSS — Mavis will analyze or refactor */
:root {
  --primary: #7c3aed;
  --bg: #0a0d1f;
}

body {
  background: var(--bg);
  color: white;
}
`,
  bash: `#!/bin/bash
# Bash script — Mavis can explain or debug it
echo "MAVIS Code Studio operational"
date
`,
};

// ── CodeMirror theme — dark HUD ───────────────────────────────────────────────
const hudTheme = EditorView.theme({
  "&": {
    color: "#e2e8f0",
    backgroundColor: "#0d0f1e",
    height: "100%",
    fontSize: "13px",
    fontFamily: "'Share Tech Mono', 'Fira Code', monospace",
  },
  ".cm-content": { caretColor: "#7c3aed", padding: "12px 0" },
  ".cm-cursor": { borderLeftColor: "#7c3aed", borderLeftWidth: "2px" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "#a78bfa" },
  ".cm-gutters": { backgroundColor: "#0a0d1f", color: "#4a5568", border: "none", borderRight: "1px solid #1a1f3a" },
  ".cm-lineNumbers .cm-gutterElement": { paddingRight: "12px", minWidth: "40px", textAlign: "right" },
  ".cm-activeLine": { backgroundColor: "#7c3aed18" },
  ".cm-activeLineGutter": { backgroundColor: "#7c3aed22", color: "#a78bfa" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#7c3aed40" },
  ".cm-matchingBracket": { color: "#a78bfa !important", backgroundColor: "#7c3aed30", fontWeight: "bold" },
  ".cm-placeholder": { color: "#3a4060" },
  ".cm-tooltip": { backgroundColor: "#1a1f3a", border: "1px solid #2d3561", borderRadius: "6px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "4px 8px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#7c3aed40" },
}, { dark: true });

// ── Highlight style ───────────────────────────────────────────────────────────
const hudHighlight = syntaxHighlighting(defaultHighlightStyle, { fallback: true });

// ── CodeEditor component ──────────────────────────────────────────────────────
function CodeEditor({
  lang, value, onChange,
}: {
  lang: LangId;
  value: string;
  onChange: (v: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const langDef = LANGS.find(l => l.id === lang);
    const langExt = langDef?.cm?.() ?? [];

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      history(),
      autocompletion(),
      hudTheme,
      hudHighlight,
      placeholder("// Write code here, or paste a GitHub URL above to analyze a repo"),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...closeBracketsKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
      ...(langExt ? [langExt] : []),
    ];

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Sync external value without re-mounting (e.g. language switch)
  const prevLang = useRef(lang);
  useEffect(() => {
    if (prevLang.current !== lang) { prevLang.current = lang; return; }
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value, lang]);

  return <div ref={containerRef} className="h-full overflow-auto" />;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CodeStudioPage() {
  const { user } = useAuth();
  const [lang, setLang] = useState<LangId>("javascript");
  const [code, setCode] = useState(PLACEHOLDER_CODE["javascript"]);
  const [activePanel, setActivePanel] = useState<MavisPanel>("mavis");
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [mavisResponse, setMavisResponse] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiAction, setAiAction] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // GitHub panel state
  const [githubUrl, setGithubUrl] = useState("");
  const [githubTask, setGithubTask] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubResult, setGithubResult] = useState<string>("");

  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
  }, [output]);

  const addLine = (type: OutputLine["type"], text: string) =>
    setOutput(prev => [...prev, { type, text }]);

  // ── Language switch ────────────────────────────────────────
  function switchLang(id: LangId) {
    setLang(id);
    setCode(PLACEHOLDER_CODE[id]);
    setOutput([]);
    setMavisResponse("");
    setGithubResult("");
  }

  // ── Run code ───────────────────────────────────────────────
  const runCode = useCallback(async () => {
    if (!user || running || !code.trim()) return;
    setRunning(true);
    setOutput([]);
    setActivePanel("output");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("mavis-code-exec", {
        body: { code, language: lang, timeout: 25 },
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });

      if (error || data?.error) {
        addLine("error", `Execution error: ${data?.error ?? error?.message}`);
        return;
      }

      if (data?.output?.length) {
        data.output.forEach((line: string) => addLine("stdout", line));
      } else if (data?.result) {
        addLine("stdout", data.result);
      }
      if (data?.stderr) addLine("stderr", data.stderr);
      if (data?.returncode === 0) {
        addLine("info", `✓ Exited 0 (${data?.provider ?? "sandbox"})`);
      } else if (data?.returncode !== undefined) {
        addLine("error", `✗ Exited ${data.returncode}`);
      }
    } catch (e: any) {
      addLine("error", e?.message ?? "Execution failed");
    } finally {
      setRunning(false);
    }
  }, [user, code, lang, running]);

  // ── AI analysis via mavis-chat ─────────────────────────────
  const runAiAction = useCallback(async (actionId: string, customPrompt?: string) => {
    if (!user || analyzing || !code.trim()) return;
    const action = AI_ACTIONS.find(a => a.id === actionId);
    if (!action && !customPrompt) return;

    setAnalyzing(true);
    setAiAction(actionId);
    setActivePanel("mavis");
    setMavisResponse("");

    const systemInstruction = customPrompt ?? action!.prompt;
    const langDef = LANGS.find(l => l.id === lang);

    try {
      const { data, error } = await supabase.functions.invoke("mavis-chat", {
        body: {
          messages: [{
            role: "user",
            content: `\`\`\`${langDef?.ext ?? lang}\n${code}\n\`\`\``,
          }],
          systemPrompt: systemInstruction,
          mode: "CODEX",
          chatKind: "code_studio",
        },
      });

      if (error || data?.error) {
        toast.error(data?.error ?? error?.message);
        return;
      }
      setMavisResponse(data?.content ?? "[No response]");
    } catch (e: any) {
      toast.error(e?.message ?? "Analysis failed");
    } finally {
      setAnalyzing(false);
      setAiAction("");
    }
  }, [user, code, lang, analyzing]);

  // ── GitHub repo analysis via mavis-code-agent ──────────────
  const analyzeRepo = useCallback(async () => {
    if (!githubUrl.trim() || githubLoading) return;

    const match = githubUrl.match(/github\.com\/([^/\s#?]+)\/([^/\s#?]+)/i);
    if (!match) {
      toast.error("Enter a valid GitHub URL: github.com/owner/repo");
      return;
    }
    const [, owner, repo] = match;
    const task = githubTask.trim() || "Analyze the codebase architecture, identify design patterns, flag quality issues, and provide a senior engineering assessment.";

    setGithubLoading(true);
    setActivePanel("github");
    setGithubResult("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("mavis-code-agent", {
        body: { task, owner, repo },
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });

      if (error || data?.error) {
        setGithubResult(`❌ ${data?.error ?? error?.message ?? "Analysis failed"}`);
        return;
      }
      setGithubResult(data?.result ?? data?.output ?? data?.content ?? JSON.stringify(data, null, 2));
    } catch (e: any) {
      setGithubResult(`❌ ${e?.message ?? "Failed to reach code agent"}`);
    } finally {
      setGithubLoading(false);
    }
  }, [githubUrl, githubTask, githubLoading]);

  // ── Copy code ──────────────────────────────────────────────
  function copyCode() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const langDef = LANGS.find(l => l.id === lang)!;
  const canRun = ["javascript", "typescript", "python", "bash"].includes(lang);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background font-mono">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 shrink-0">
        <TerminalSquare size={15} className="text-primary" />
        <span className="text-xs font-semibold tracking-widest text-primary uppercase">Code Studio</span>
        <span className="text-[10px] text-muted-foreground/50">VANTARA.EXE</span>
        <div className="flex-1" />

        {/* GitHub URL bar */}
        <div className="flex items-center gap-2 flex-1 max-w-xl">
          <Github size={13} className="text-muted-foreground shrink-0" />
          <input
            value={githubUrl}
            onChange={e => setGithubUrl(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") analyzeRepo(); }}
            placeholder="github.com/owner/repo"
            className="flex-1 bg-muted/30 border border-border/50 rounded px-2 py-1 text-[11px] text-foreground placeholder-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
          <button
            onClick={analyzeRepo}
            disabled={githubLoading || !githubUrl.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary/15 hover:bg-primary/25 text-primary text-[10px] disabled:opacity-40 transition-colors"
          >
            {githubLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Analyze Repo
          </button>
        </div>
      </div>

      {/* ── Body: Editor + Panel ─────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Editor ─────────────────────────────────── */}
        <div className="flex flex-col border-r border-border/50" style={{ width: "55%" }}>

          {/* Editor toolbar */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/30 bg-muted/10 shrink-0">
            {/* Language tabs */}
            <div className="flex items-center gap-0.5 flex-1">
              {LANGS.map(l => (
                <button
                  key={l.id}
                  onClick={() => switchLang(l.id)}
                  className={`px-2.5 py-1 rounded text-[10px] transition-colors ${
                    lang === l.id
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            {/* Action buttons */}
            <button onClick={copyCode} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors">
              {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
            </button>
            <button onClick={() => setCode(PLACEHOLDER_CODE[lang])} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors">
              <RefreshCw size={10} />
            </button>
            <button onClick={() => { setCode(""); setOutput([]); }} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors">
              <Trash2 size={10} />
            </button>
          </div>

          {/* CodeMirror editor */}
          <div className="flex-1 overflow-hidden">
            <CodeEditor lang={lang} value={code} onChange={setCode} />
          </div>

          {/* Run + AI action bar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-t border-border/30 bg-muted/10 shrink-0 flex-wrap">
            {canRun && (
              <button
                onClick={running ? undefined : runCode}
                disabled={running || !code.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-[10px] disabled:opacity-40 transition-colors"
              >
                {running ? <Square size={11} className="animate-pulse" /> : <Play size={11} />}
                {running ? "Running…" : "Run"}
              </button>
            )}

            {AI_ACTIONS.map(action => {
              const Icon = action.icon;
              const isActive = aiAction === action.id && analyzing;
              return (
                <button
                  key={action.id}
                  onClick={() => runAiAction(action.id)}
                  disabled={analyzing || !code.trim()}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] transition-colors disabled:opacity-40 ${
                    isActive
                      ? "bg-primary/25 border border-primary/50 text-primary"
                      : "bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground border border-transparent hover:border-border/50"
                  }`}
                >
                  {isActive ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: Panels ────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Panel tabs */}
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border/30 bg-muted/10 shrink-0">
            {[
              { id: "mavis" as MavisPanel, label: "MAVIS", icon: Sparkles },
              { id: "output" as MavisPanel, label: "Output", icon: TerminalSquare },
              { id: "github" as MavisPanel, label: "Repo Analysis", icon: Github },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActivePanel(id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-[10px] transition-colors ${
                  activePanel === id
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
                }`}
              >
                <Icon size={10} />
                {label}
                {id === "output" && output.length > 0 && (
                  <span className="ml-1 px-1 py-0.5 rounded text-[8px] bg-muted/40">{output.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-hidden relative">

            {/* MAVIS panel */}
            {activePanel === "mavis" && (
              <div className="h-full overflow-y-auto p-4">
                {analyzing && (
                  <div className="flex items-center gap-2 text-xs text-primary animate-pulse mb-4">
                    <Loader2 size={13} className="animate-spin" />
                    MAVIS is analyzing your code…
                  </div>
                )}
                {!mavisResponse && !analyzing && (
                  <div className="text-center py-16 text-muted-foreground/40">
                    <Sparkles size={28} className="mx-auto mb-3 opacity-40" />
                    <p className="text-xs">Select an AI action below the editor</p>
                    <p className="text-[10px] mt-1">Analyze · Explain · Debug · Refactor · Review · Generate Tests</p>
                  </div>
                )}
                {mavisResponse && (
                  <div className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed">
                    <ReactMarkdown>{mavisResponse}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            {/* Output panel */}
            {activePanel === "output" && (
              <div
                ref={outputRef}
                className="h-full overflow-y-auto p-3 bg-black/30 font-mono text-[11px] leading-relaxed"
              >
                {output.length === 0 && (
                  <div className="text-muted-foreground/40 text-center py-12">
                    <Play size={24} className="mx-auto mb-2 opacity-30" />
                    <p>Hit Run ▶ to execute your code</p>
                    {!canRun && <p className="text-[10px] mt-1">Switch to JavaScript, TypeScript, Python, or Bash to run code</p>}
                  </div>
                )}
                {output.map((line, i) => (
                  <div key={i} className={`flex gap-2 ${
                    line.type === "stderr" || line.type === "error" ? "text-red-400"
                      : line.type === "info" ? "text-emerald-400"
                      : "text-green-300"
                  }`}>
                    <span className="text-muted-foreground/40 select-none w-5 shrink-0 text-right">{i + 1}</span>
                    <span className="whitespace-pre-wrap break-all">{line.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* GitHub Repo Analysis panel */}
            {activePanel === "github" && (
              <div className="h-full overflow-y-auto p-4">
                {/* Task input */}
                <div className="mb-4">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 block">Analysis task (optional)</label>
                  <div className="flex gap-2">
                    <input
                      value={githubTask}
                      onChange={e => setGithubTask(e.target.value)}
                      placeholder="e.g. Review security, explain architecture, find performance issues…"
                      className="flex-1 bg-muted/20 border border-border/50 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-primary/50"
                    />
                    <button
                      onClick={analyzeRepo}
                      disabled={githubLoading || !githubUrl.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary/15 hover:bg-primary/25 text-primary text-xs disabled:opacity-40 transition-colors"
                    >
                      {githubLoading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      Run
                    </button>
                  </div>
                </div>

                {githubLoading && (
                  <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
                    <Loader2 size={24} className="animate-spin text-primary" />
                    <p className="text-xs">MAVIS Code Agent is walking the repo tree…</p>
                    <p className="text-[10px] opacity-50">This may take 30–60s for large repos</p>
                  </div>
                )}

                {!githubResult && !githubLoading && (
                  <div className="text-center py-16 text-muted-foreground/40">
                    <Github size={28} className="mx-auto mb-3 opacity-40" />
                    <p className="text-xs">Paste a GitHub URL in the header bar and click Analyze Repo</p>
                    <p className="text-[10px] mt-1">Powered by mavis-code-agent — reads files, understands architecture</p>
                  </div>
                )}

                {githubResult && (
                  <div className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed">
                    {githubUrl && (
                      <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-muted/20 rounded-lg border border-border/30">
                        <Github size={12} className="text-muted-foreground" />
                        <a
                          href={githubUrl.startsWith("http") ? githubUrl : `https://${githubUrl}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-primary hover:underline flex items-center gap-1"
                        >
                          {githubUrl.replace(/^https?:\/\//, "")}
                          <ExternalLink size={9} />
                        </a>
                      </div>
                    )}
                    <ReactMarkdown>{githubResult}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick task chips for GitHub */}
          {activePanel === "github" && !githubLoading && (
            <div className="px-3 py-2 border-t border-border/30 bg-muted/5 flex gap-1.5 flex-wrap shrink-0">
              {[
                "Architecture overview",
                "Security audit",
                "Performance review",
                "Find bugs",
                "Explain codebase to a new dev",
                "Code quality score",
              ].map(chip => (
                <button
                  key={chip}
                  onClick={() => setGithubTask(chip)}
                  className="px-2 py-0.5 rounded text-[10px] bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors border border-border/30"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
