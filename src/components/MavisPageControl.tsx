import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, X, ArrowRight, Loader2, ChevronDown } from "lucide-react";
import { usePageAgent } from "@/hooks/usePageAgent";
import type { PageAction } from "@/hooks/usePageAgent";

const SUGGESTIONS = [
  "Open MAVIS chat",
  "Go to Journal",
  "Open the Agency tab",
  "Go to my Goals",
  "Open Settings",
  "Navigate to Knowledge Graph",
];

export function MavisPageControl() {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<{ command: string; result: PageAction }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { execute, running } = usePageAgent();

  // Open with keyboard shortcut Ctrl+Shift+M
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "M") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const submit = useCallback(async (cmd = command) => {
    const trimmed = cmd.trim();
    if (!trimmed || running) return;
    setCommand("");
    const result = await execute(trimmed);
    setHistory(h => [{ command: trimmed, result }, ...h].slice(0, 10));
    // Close panel after a successful navigation
    if (result.action === "navigate") setTimeout(() => setOpen(false), 300);
  }, [command, running, execute]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[998]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed bottom-20 right-4 z-[999] w-80 transition-all duration-200 ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-3 pointer-events-none"
        }`}
      >
        <div className="rounded-xl border border-amber-500/30 bg-background/95 backdrop-blur-xl shadow-2xl shadow-amber-500/10 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
            <div className="flex items-center gap-2">
              <Bot size={14} className="text-amber-400" />
              <span className="text-xs font-mono font-semibold text-amber-400">MAVIS CONTROL</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="max-h-40 overflow-y-auto px-3 py-2 border-b border-border/40 space-y-2">
              {history.slice(0, 3).map((item, i) => (
                <div key={i} className="text-xs">
                  <span className="text-muted-foreground font-mono">⌘ {item.command}</span>
                  <div className="mt-0.5 text-amber-400/80 pl-3">
                    {item.result.action === "respond"
                      ? item.result.message
                      : `✓ ${item.result.description}`}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <input
              ref={inputRef}
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Tell MAVIS what to do…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 text-foreground"
              disabled={running}
            />
            <button
              onClick={() => submit()}
              disabled={!command.trim() || running}
              className="shrink-0 text-amber-400 disabled:text-muted-foreground/30 hover:text-amber-300 transition-colors"
            >
              {running ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
            </button>
          </div>

          {/* Suggestions */}
          {!history.length && (
            <div className="px-3 pb-3 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/20 text-amber-400/70 hover:text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors font-mono"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="px-3 pb-2 text-[9px] text-muted-foreground/40 font-mono">
            Ctrl+Shift+M to toggle · Enter to run · Esc to close
          </div>
        </div>
      </div>

      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-4 right-4 z-[999] flex items-center gap-1.5 px-3 py-2 rounded-full shadow-lg transition-all duration-200 font-mono text-xs font-semibold ${
          open
            ? "bg-amber-500 text-black shadow-amber-500/40"
            : "bg-background border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/60 shadow-amber-500/10"
        }`}
        title="MAVIS Page Control (Ctrl+Shift+M)"
      >
        <Bot size={14} />
        <span>MAVIS ⌘</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
    </>
  );
}
