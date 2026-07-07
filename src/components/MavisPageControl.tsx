import { useState, useRef, useEffect, useCallback, useId } from "react";
import { Bot, X, ArrowRight, Loader2, ChevronDown, Trash2, Zap } from "lucide-react";
import { usePageAgent } from "@/hooks/usePageAgent";
import { streamChatMessage } from "@/mavis/chatService";
import { useLocation } from "react-router-dom";

// ── Device identity (foundation for multi-device orchestration) ───────────────
// Each browser session gets a persistent device ID stored in localStorage.
// Future: register to mavis_control_sessions table so MAVIS can address
// any connected device by ID (e.g. "open journal on my phone").
const DEVICE_KEY = "vantara-device-id";
function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// ── Message thread types ──────────────────────────────────────────────────────
type MsgRole = "user" | "mavis" | "action";
type Msg = {
  id: string;
  role: MsgRole;
  text: string;
  streaming?: boolean;
};

// ── Draggable XY (same pattern as sidebar toggle) ─────────────────────────────
const POS_KEY = "vantara-mavis-control-pos";
const BTN_W = 108;
const BTN_H = 36;
const GAP = 8;

function defaultPos() {
  return {
    x: (typeof window !== "undefined" ? window.innerWidth : 400) - BTN_W - GAP * 2,
    y: (typeof window !== "undefined" ? window.innerHeight : 800) - BTN_H - GAP * 2,
  };
}

function useDraggableXY() {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const stored = localStorage.getItem(POS_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return defaultPos();
  });

  const dragging = useRef(false);
  const didMove = useRef(false);
  const startPtr = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });

  const clamp = useCallback((x: number, y: number) => ({
    x: Math.max(GAP, Math.min(x, window.innerWidth  - BTN_W - GAP)),
    y: Math.max(GAP, Math.min(y, window.innerHeight - BTN_H - GAP)),
  }), []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    didMove.current = false;
    startPtr.current = { x: e.clientX, y: e.clientY };
    startPos.current = pos;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - startPtr.current.x;
    const dy = e.clientY - startPtr.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didMove.current = true;
    setPos(clamp(startPos.current.x + dx, startPos.current.y + dy));
  }, [clamp]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    const dx = e.clientX - startPtr.current.x;
    const dy = e.clientY - startPtr.current.y;
    const next = clamp(startPos.current.x + dx, startPos.current.y + dy);
    localStorage.setItem(POS_KEY, JSON.stringify(next));
  }, [clamp]);

  useEffect(() => {
    const onResize = () => {
      setPos(prev => {
        const clamped = {
          x: Math.max(GAP, Math.min(prev.x, window.innerWidth  - BTN_W - GAP)),
          y: Math.max(GAP, Math.min(prev.y, window.innerHeight - BTN_H - GAP)),
        };
        localStorage.setItem(POS_KEY, JSON.stringify(clamped));
        return clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { pos, didMove, onPointerDown, onPointerMove, onPointerUp };
}

// ── System prompt for the mini chat ──────────────────────────────────────────
function buildSystemPrompt(route: string, deviceId: string): string {
  return `You are MAVIS operating from the floating Command Panel in VANTARA.EXE.
Device ID: ${deviceId}
Current route: ${route}

ROLE: You are a fast, context-aware AI assistant. From this panel you can:
- Answer questions about the app, Calvin's data, or anything else
- Confirm actions you've taken (navigation, clicks, etc.)
- Help Calvin think through problems quickly

STYLE: Keep responses SHORT and direct. This is a command panel, not the main chat.
Under 3 sentences unless the question genuinely needs more depth.
Never repeat the question back. No filler phrases.

If Calvin asks you to navigate or open something, acknowledge it concisely.
If Calvin asks a question, answer it immediately.`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function MavisPageControl() {
  const uid = useId();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);
  const deviceId = useRef(getDeviceId());

  const { execute, running: navRunning } = usePageAgent();
  const { pos, didMove, onPointerDown, onPointerMove, onPointerUp } = useDraggableXY();

  const openAbove = pos.y > window.innerHeight / 2;
  const alignRight = pos.x > window.innerWidth / 2;
  const busy = navRunning || isTyping;

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  // Keyboard shortcuts
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

  const addMsg = useCallback((role: MsgRole, text: string, streaming = false): string => {
    const id = `${uid}-${Date.now()}-${Math.random()}`;
    setMessages(m => [...m, { id, role, text, streaming }]);
    return id;
  }, [uid]);

  const updateMsg = useCallback((id: string, text: string, streaming = false) => {
    setMessages(m => m.map(msg => msg.id === id ? { ...msg, text, streaming } : msg));
  }, []);

  const clearThread = useCallback(() => {
    // Cancel any in-flight stream
    abortRef.current?.abort();
    setMessages([]);
    historyRef.current = [];
    setIsTyping(false);
    setInput("");
  }, []);

  const send = useCallback(async (text = input) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");

    addMsg("user", trimmed);
    historyRef.current = [...historyRef.current, { role: "user", content: trimmed }];

    // ── Try navigation/action first ────────────────────────────────────────
    const result = await execute(trimmed);

    if (result.action !== "respond") {
      // Action was executed — show brief confirmation, then ask MAVIS to comment
      addMsg("action", `✓ ${result.description}`);
      historyRef.current = [...historyRef.current, { role: "assistant", content: result.description }];
      return;
    }

    // ── Conversational — stream from MAVIS ─────────────────────────────────
    setIsTyping(true);
    const msgId = addMsg("mavis", "", true);
    abortRef.current = new AbortController();

    try {
      await streamChatMessage(
        trimmed,
        buildSystemPrompt(location.pathname, deviceId.current),
        historyRef.current.slice(-10), // last 5 turns
        { mode: "PRIME", chatKind: "command-panel", threadRef: `panel-${deviceId.current}` },
        (_token, accumulated) => {
          updateMsg(msgId, accumulated, true);
        },
        undefined,
        abortRef.current.signal,
      );

      // Finalize — strip streaming cursor
      setMessages(m => m.map(msg =>
        msg.id === msgId ? { ...msg, streaming: false } : msg
      ));

      // Update history with the final MAVIS response
      const finalText = (await new Promise<string>(res => {
        setMessages(m => {
          const found = m.find(msg => msg.id === msgId);
          res(found?.text ?? "");
          return m;
        });
      }));
      historyRef.current = [...historyRef.current, { role: "assistant", content: finalText }];

    } catch (e: unknown) {
      const cancelled = e instanceof Error && e.name === "AbortError";
      if (!cancelled) {
        updateMsg(msgId, "Couldn't reach MAVIS right now. Try again.", false);
      }
    } finally {
      setIsTyping(false);
    }
  }, [input, busy, execute, location.pathname, addMsg, updateMsg]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // Panel position
  const panelStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 999,
    width: 340,
    left: alignRight ? undefined : pos.x,
    right: alignRight ? window.innerWidth - pos.x - BTN_W : undefined,
    ...(openAbove
      ? { bottom: window.innerHeight - pos.y + 6 }
      : { top: pos.y + BTN_H + 6 }),
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-[998]" onClick={() => setOpen(false)} />}

      {/* Panel */}
      <div
        style={panelStyle}
        className={`transition-all duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="rounded-xl border border-amber-500/30 bg-background/97 backdrop-blur-xl shadow-2xl shadow-amber-500/10 overflow-hidden flex flex-col max-h-[60vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-amber-500/20 bg-amber-500/5 shrink-0">
            <div className="flex items-center gap-2">
              <Bot size={13} className="text-amber-400" />
              <span className="text-xs font-mono font-semibold text-amber-400">MAVIS ⌘</span>
              <span className="text-[9px] font-mono text-amber-400/40 ml-1">
                {deviceId.current}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearThread}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Clear thread"
                >
                  <Trash2 size={12} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Message thread */}
          {messages.length > 0 && (
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
              {messages.map((msg) => (
                <div key={msg.id} className={`text-xs ${msg.role === "user" ? "text-right" : "text-left"}`}>
                  {msg.role === "user" && (
                    <span className="inline-block px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/20 text-foreground max-w-[85%]">
                      {msg.text}
                    </span>
                  )}
                  {msg.role === "mavis" && (
                    <span className={`inline-block text-left text-muted-foreground leading-relaxed ${msg.streaming ? "after:content-['▋'] after:animate-pulse after:ml-0.5 after:text-amber-400" : ""}`}>
                      {msg.text || <Loader2 size={11} className="animate-spin text-amber-400 inline" />}
                    </span>
                  )}
                  {msg.role === "action" && (
                    <span className="inline-flex items-center gap-1 text-amber-400/70 font-mono text-[10px]">
                      <Zap size={9} />
                      {msg.text}
                    </span>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="px-3 py-3 flex flex-wrap gap-1.5 shrink-0">
              {[
                "Open MAVIS chat",
                "Go to Journal",
                "Open the Agency tab",
                "What's my XP?",
                "Go to my Goals",
                "Open Settings",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/20 text-amber-400/70 hover:text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors font-mono"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-amber-500/20 bg-amber-500/5 shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={busy ? "MAVIS is thinking…" : "Command or ask MAVIS anything…"}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40 text-foreground"
              disabled={busy}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || busy}
              className="shrink-0 text-amber-400 disabled:text-muted-foreground/30 hover:text-amber-300 transition-colors"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            </button>
          </div>

          <div className="px-3 pb-1.5 text-[9px] text-muted-foreground/30 font-mono shrink-0">
            Drag button · Ctrl+Shift+M · Esc
          </div>
        </div>
      </div>

      {/* Floating trigger — draggable */}
      <button
        style={{ top: pos.y, left: pos.x, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => { if (!didMove.current) setOpen(o => !o); }}
        className={`fixed z-[999] flex items-center gap-1.5 px-3 py-2 rounded-full shadow-lg transition-colors duration-200 font-mono text-xs font-semibold cursor-grab active:cursor-grabbing select-none ${
          open
            ? "bg-amber-500 text-black shadow-amber-500/40"
            : "bg-background border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/60 shadow-amber-500/10"
        }`}
        title="Drag to reposition · Click to open (Ctrl+Shift+M)"
      >
        <Bot size={14} />
        <span>MAVIS ⌘</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
    </>
  );
}
