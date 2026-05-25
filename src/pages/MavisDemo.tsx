import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, ChevronDown, ChevronUp, RotateCcw, Mic } from "lucide-react";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";

// ── Types ─────────────────────────────────────────────────────
type Phase = "idle" | "thinking" | "streaming";

interface Brief {
  id: string;
  query: string;
  response: string;
  type: string;
  ts: number;
}

// ── Config ────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const HISTORY_KEY = "mavis_demo_v1";
const MAX_HISTORY = 5;

const TYPE_COLOR: Record<string, string> = {
  Strategy: "text-purple-400",
  Analysis: "text-cyan-400",
  Brief: "text-amber-400",
  Insight: "text-emerald-400",
  Data: "text-blue-400",
  Alert: "text-red-400",
};

const TYPE_BORDER: Record<string, string> = {
  Strategy: "border-purple-400/30",
  Analysis: "border-cyan-400/30",
  Brief: "border-amber-400/30",
  Insight: "border-emerald-400/30",
  Data: "border-blue-400/30",
  Alert: "border-red-400/30",
};

// ── Neural network canvas hook ────────────────────────────────
function useNeuralCanvas(
  ref: React.RefObject<HTMLCanvasElement>,
  active: boolean,
) {
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const N = 60;
    const nodes = Array.from({ length: N }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      r: 1 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
    }));

    const MAX_D = 155;
    let raf: number;
    let t = 0;

    const frame = () => {
      t += 0.013;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      const act = activeRef.current;

      ctx.clearRect(0, 0, W, H);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0) { n.x = 0; n.vx = Math.abs(n.vx); }
        if (n.x > W) { n.x = W; n.vx = -Math.abs(n.vx); }
        if (n.y < 0) { n.y = 0; n.vy = Math.abs(n.vy); }
        if (n.y > H) { n.y = H; n.vy = -Math.abs(n.vy); }
        n.phase += 0.014;
      }

      // Connections
      const edgeMult = act ? 2.8 : 1;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_D) {
            const a = ((1 - dist / MAX_D) * 0.11 * edgeMult).toFixed(3);
            ctx.beginPath();
            ctx.strokeStyle = `rgba(250,189,47,${a})`;
            ctx.lineWidth = 0.55;
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Nodes
      for (const n of nodes) {
        const glow = act ? 1.9 : 1;
        const pulse = ((0.3 + 0.22 * Math.sin(n.phase + t)) * glow).toFixed(3);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(250,189,47,${pulse})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
}

// ── Waveform component ────────────────────────────────────────
function Waveform({ phase }: { phase: Phase }) {
  const BARS = 30;
  const props = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => ({
        base: 3 + Math.abs(Math.sin(i * 0.65)) * 4,
        peak: 10 + Math.abs(Math.sin(i * 1.05 + 0.4)) * 22,
        dur: 0.28 + (i % 8) * 0.04,
        delay: i * 0.022,
      })),
    [],
  );

  return (
    <div className="flex items-end justify-center gap-[2.5px] h-10 opacity-80">
      {props.map((b, i) => {
        const h =
          phase === "thinking"
            ? [`${b.base + 1}px`, `${b.peak}px`, `${b.base + 1}px`]
            : phase === "streaming"
            ? [`${b.base}px`, `${b.peak * 0.6}px`, `${b.base}px`]
            : [`${b.base}px`, `${b.base + 1.5}px`, `${b.base}px`];
        return (
          <motion.div
            key={i}
            style={{ width: "3px", background: "hsl(var(--primary))" }}
            className="rounded-t-full"
            animate={{ height: h, opacity: phase === "idle" ? 0.28 : phase === "thinking" ? 0.9 : 0.65 }}
            transition={{ duration: phase === "thinking" ? b.dur * 0.65 : b.dur, repeat: Infinity, delay: b.delay, ease: "easeInOut" }}
          />
        );
      })}
    </div>
  );
}

// ── System stats that slowly drift ───────────────────────────
function useStats(active: boolean) {
  const [s, setS] = useState({ cpu: 4, ram: 16, latency: 18, sync: 94 });
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    const id = setInterval(() => {
      const a = activeRef.current;
      setS(p => ({
        cpu: clamp(p.cpu + rnd(a ? 7 : 2), 1, a ? 48 : 12),
        ram: clamp(p.ram + rnd(1.5), 12, 28),
        latency: clamp(p.latency + rnd(a ? 22 : 5), 8, a ? 130 : 38),
        sync: clamp(p.sync + rnd(0.9), 87, 99),
      }));
    }, 2200);
    return () => clearInterval(id);
  }, []);

  return s;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function rnd(range: number) { return (Math.random() - 0.5) * range; }

// ── Live clock ────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ── LocalStorage history ──────────────────────────────────────
function loadHistory(): Brief[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); }
  catch { return []; }
}

function saveHistory(h: Brief[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)));
}

// ── Status label ──────────────────────────────────────────────
const STATUS_LABEL: Record<Phase, string> = {
  idle: "ONLINE",
  thinking: "PROCESSING",
  streaming: "TRANSMITTING",
};
const STATUS_DETAIL: Record<Phase, string> = {
  idle: "OPTIMAL",
  thinking: "ACTIVE",
  streaming: "STREAMING",
};

// ── Main page ─────────────────────────────────────────────────
export default function MavisDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [type, setType] = useState("Brief");
  const [response, setResponse] = useState("");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Brief[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const accRef = useRef("");
  const typeRef = useRef("Brief");

  const now = useClock();
  const stats = useStats(phase !== "idle");
  useNeuralCanvas(canvasRef, phase !== "idle");

  // Auto-scroll response area as text streams in
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response]);

  const submit = useCallback(async () => {
    const q = query.trim();
    if (!q || phase !== "idle") return;

    setQuery("");
    setPhase("thinking");
    setResponse("");
    setType("Brief");
    accRef.current = "";
    typeRef.current = "Brief";

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-demo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ query: q }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error("unavailable");

      setPhase("streaming");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";

        for (const block of blocks) {
          if (!block.startsWith("data: ")) continue;
          try {
            const j = JSON.parse(block.slice(6));
            if (j.response_type) { setType(j.response_type); typeRef.current = j.response_type; }
            if (j.done) break;
            if (j.chunk) { accRef.current += j.chunk; setResponse(accRef.current); }
          } catch { /* malformed SSE */ }
        }
      }

      // Persist to history
      const brief: Brief = { id: String(Date.now()), query: q, response: accRef.current, type: typeRef.current, ts: Date.now() };
      setHistory(prev => { const next = [brief, ...prev].slice(0, MAX_HISTORY); saveHistory(next); return next; });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      accRef.current = "Signal temporarily degraded. MAVIS standing by for next transmission.";
      setResponse(accRef.current);
    } finally {
      setPhase("idle");
    }
  }, [query, phase]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const tc = TYPE_COLOR[type] ?? "text-amber-400";
  const tb = TYPE_BORDER[type] ?? "border-amber-400/30";

  return (
    <div className="relative min-h-screen w-full overflow-hidden flex flex-col font-mono select-none"
      style={{ background: "hsl(228 55% 3%)" }}>

      {/* ── Neural network canvas background ─────────────────── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: 0.65 }}
      />

      {/* Scan line animation */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute w-full h-[1px] bg-gradient-to-r from-transparent via-amber-400/15 to-transparent animate-scan" />
      </div>

      {/* Radial vignette */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.72) 100%)" }} />

      {/* ── HEADER ───────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-3 border-b"
        style={{ borderColor: "rgba(250,189,47,0.1)", background: "rgba(0,0,0,0.55)" }}>

        {/* Brand mark */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-7 h-7">
            {/* Outer ring — pings when active */}
            <div className={`absolute inset-0 rounded border border-amber-400/25 ${phase !== "idle" ? "animate-ping" : ""}`}
              style={{ animationDuration: "2s" }} />
            <div className="w-7 h-7 rounded border border-amber-400/50 flex items-center justify-center bg-amber-400/5">
              <div className={`w-2.5 h-2.5 rounded-sm bg-amber-400 ${phase !== "idle" ? "animate-pulse" : "opacity-80"}`} />
            </div>
          </div>
          <div>
            <span className="text-amber-400 font-display text-sm font-bold tracking-[0.3em]">MAVIS</span>
            <span className="text-xs text-white/20 tracking-[0.15em] ml-3 hidden sm:inline">
              MASTER ARTIFICIAL VANTARA INTELLIGENCE SYSTEM
            </span>
          </div>
        </div>

        {/* Clock — hidden on very small screens */}
        <div className="text-center hidden md:block">
          <p className="text-[9px] text-white/30 tracking-widest uppercase">{dateStr}</p>
          <p className="text-amber-400/80 text-[11px] tracking-widest tabular-nums">{timeStr}</p>
        </div>

        {/* Status block */}
        <div className="flex items-center gap-3 text-[10px] tracking-widest">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${phase === "idle" ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
            <span className={`hidden sm:block ${phase === "idle" ? "text-emerald-400/80" : "text-amber-400/80"}`}>
              {STATUS_LABEL[phase]}
            </span>
          </div>
          <span className="text-white/20 hidden lg:block">SYNC {Math.round(stats.sync)}%</span>
          <span className={`hidden sm:block font-bold ${phase === "idle" ? "text-emerald-400/60" : "text-amber-400/60"}`}>
            {STATUS_DETAIL[phase]}
          </span>
        </div>
      </header>

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-8 py-6 gap-5 min-h-0">

        {/* Response type tag */}
        <AnimatePresence mode="wait">
          {(phase !== "idle" || response) && (
            <motion.div
              key={type}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-4"
            >
              <div className="h-px w-10 sm:w-20 bg-gradient-to-r from-transparent to-amber-400/30" />
              <span className={`text-[10px] font-bold tracking-[0.35em] uppercase border px-2.5 py-0.5 rounded-sm ${tc} ${tb}`}
                style={{ background: "rgba(0,0,0,0.4)" }}>
                {type}
              </span>
              <div className="h-px w-10 sm:w-20 bg-gradient-to-l from-transparent to-amber-400/30" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Response text area */}
        <div
          ref={responseRef}
          className="w-full max-w-2xl overflow-y-auto"
          style={{ scrollbarWidth: "none", maxHeight: "45vh", minHeight: "140px" }}
        >
          {phase === "thinking" && !response ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map(i => (
                  <motion.div
                    key={i}
                    className="w-1 h-1 rounded-full bg-amber-400"
                    animate={{ opacity: [0.15, 1, 0.15], scale: [0.7, 1.3, 0.7] }}
                    transition={{ duration: 0.85, repeat: Infinity, delay: i * 0.17 }}
                  />
                ))}
              </div>
              <span className="text-white/20 text-[10px] tracking-[0.3em] animate-pulse">PROCESSING QUERY</span>
            </div>
          ) : response ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="text-sm sm:text-[15px] leading-7 sm:leading-8 text-white/85 whitespace-pre-wrap text-center sm:text-left"
              style={{ fontFamily: "'Share Tech Mono', monospace" }}
            >
              {response}
              {phase === "streaming" && (
                <motion.span
                  className="inline-block w-[2px] h-[1em] bg-amber-400 ml-[2px] align-middle"
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.45, repeat: Infinity }}
                />
              )}
            </motion.p>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-10 gap-2"
            >
              <div className="w-12 h-[1px] bg-amber-400/20" />
              <p className="text-white/20 text-[10px] tracking-[0.35em] uppercase">Sovereign Intelligence Standing By</p>
              <p className="text-white/10 text-[9px] tracking-widest">Enter a query to receive a MAVIS brief</p>
              <div className="w-12 h-[1px] bg-amber-400/20" />
            </motion.div>
          )}
        </div>

        {/* Waveform visualizer */}
        <Waveform phase={phase} />

        {/* Input field */}
        <div className="w-full max-w-2xl flex flex-col gap-1.5">
          <div className={[
            "relative flex items-end gap-3 rounded-sm border px-4 py-3 transition-all duration-400",
            phase !== "idle"
              ? "border-amber-400/35 shadow-[0_0_24px_rgba(250,189,47,0.12)]"
              : "border-white/8 hover:border-white/15 focus-within:border-amber-400/35 focus-within:shadow-[0_0_24px_rgba(250,189,47,0.10)]",
          ].join(" ")}
            style={{ background: "rgba(0,0,0,0.55)" }}>

            {/* Prompt glyph */}
            <span className="text-amber-400/40 text-sm mb-0.5 shrink-0 select-none">›_</span>

            <textarea
              ref={inputRef}
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                // Auto-grow
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={handleKey}
              disabled={phase !== "idle"}
              placeholder={
                phase === "idle"
                  ? "Ask MAVIS anything..."
                  : phase === "thinking"
                  ? "Processing query..."
                  : "Receiving intelligence..."
              }
              rows={1}
              className="flex-1 bg-transparent text-[13px] text-white/85 placeholder:text-white/18 resize-none outline-none leading-6"
              style={{ scrollbarWidth: "none", fontFamily: "'Share Tech Mono', monospace", minHeight: "24px" }}
            />

            <button
              onClick={submit}
              disabled={!query.trim() || phase !== "idle"}
              className="shrink-0 w-8 h-8 rounded-sm flex items-center justify-center border border-amber-400/25 text-amber-400/60 hover:text-amber-400 hover:border-amber-400/55 hover:bg-amber-400/8 disabled:opacity-25 disabled:cursor-not-allowed transition-all duration-200"
            >
              {phase !== "idle"
                ? <Loader2 size={14} className="animate-spin" />
                : <Send size={14} />
              }
            </button>
          </div>

          <p className="text-[9px] text-white/12 text-center tracking-[0.3em] uppercase">
            Enter to transmit · Shift+Enter for newline
          </p>
        </div>

        {/* Brief history */}
        {history.length > 0 && (
          <div className="w-full max-w-2xl">
            <button
              onClick={() => setHistoryOpen(v => !v)}
              className="w-full flex items-center justify-between text-[9px] text-white/20 hover:text-white/35 tracking-[0.3em] uppercase transition-colors py-2 px-1"
            >
              <span>Recent Briefs ({history.length})</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setHistory([]);
                    localStorage.removeItem(HISTORY_KEY);
                  }}
                  className="text-white/15 hover:text-red-400/50 transition-colors p-0.5"
                  title="Clear history"
                >
                  <RotateCcw size={9} />
                </button>
                {historyOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </div>
            </button>

            <AnimatePresence>
              {historyOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden"
                >
                  <div className="flex flex-col gap-1.5 pb-2">
                    {history.map(b => (
                      <button
                        key={b.id}
                        onClick={() => { setResponse(b.response); setType(b.type); }}
                        className="text-left rounded-sm border border-white/5 hover:border-amber-400/15 px-4 py-3 transition-all duration-200 group"
                        style={{ background: "rgba(255,255,255,0.018)" }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-[9px] font-bold tracking-[0.3em] ${TYPE_COLOR[b.type] ?? "text-amber-400"} opacity-80`}>
                            [{b.type}]
                          </span>
                          <span className="text-[9px] text-white/20">
                            {new Date(b.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-[11px] text-white/35 truncate group-hover:text-white/50 transition-colors">{b.query}</p>
                        <p className="text-[11px] text-white/20 line-clamp-2 mt-0.5 leading-[18px]">
                          {b.response.slice(0, 150)}…
                        </p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer
        className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-2.5 border-t text-[9px] tracking-widest"
        style={{ borderColor: "rgba(250,189,47,0.08)", background: "rgba(0,0,0,0.55)" }}
      >
        <div className="flex items-center gap-3 sm:gap-5 text-white/25">
          <span>CPU <span className="text-amber-400/45">{Math.round(stats.cpu)}%</span></span>
          <span>RAM <span className="text-amber-400/45">{Math.round(stats.ram)}%</span></span>
          <span className="hidden sm:inline">
            LATENCY <span className="text-amber-400/45">{Math.round(stats.latency)}ms</span>
          </span>
          <span className="hidden md:inline">
            NET <span className="text-emerald-400/50">STABLE</span>
          </span>
        </div>
        <span className="text-white/12 tracking-[0.25em] text-[8px] uppercase">
          Powered by Vantara
        </span>
      </footer>
    </div>
  );
}
