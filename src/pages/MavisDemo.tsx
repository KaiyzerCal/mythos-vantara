import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2, Mic, Square, ChevronDown, Brain, Target, Crown, Flame, Database, Cpu, Search, Zap, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/contexts/AppDataContext";
import { supabase } from "@/integrations/supabase/client";
import { buildSystemPromptFromSnapshot } from "@/mavis/buildSystemPrompt";
import { streamChatMessage, streamAgentMessage, streamResearchMessage } from "@/mavis/chatService";
import { loadFullAppContext } from "@/mavis/appContextLoader";
import { initSession } from "@/mavis/memoryEngine";
import { loadRuntimeSkills } from "@/mavis/skills/_registry";
import { gatherProviderContext } from "@/mavis/contextProviders";
import { buildRecallContext } from "@/mavis/proactiveRecall";
import { captureProceduralMemory } from "@/mavis/proceduralMemory";
import { setDefaultHandler, registerActionHandler } from "@/mavis/actionExecutor";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";
import "@/mavis/skills/_loader";

// ── Mode config (mirrors MavisChat) ─────────────────────────
const MODES = [
  { id: "PRIME",      label: "PRIME",     icon: Crown,    color: "text-amber-400"   },
  { id: "ARCH",       label: "ARCH",      icon: Brain,    color: "text-purple-400"  },
  { id: "QUEST",      label: "QUEST",     icon: Target,   color: "text-red-400"     },
  { id: "FORGE",      label: "FORGE",     icon: Flame,    color: "text-orange-400"  },
  { id: "CODEX",      label: "CODEX",     icon: Database, color: "text-cyan-400"    },
  { id: "SOVEREIGN",  label: "SOVEREIGN", icon: Crown,    color: "text-amber-300"   },
  { id: "ENRYU",      label: "ENRYU",     icon: Flame,    color: "text-red-500"     },
  { id: "WATCHTOWER", label: "WATCH",     icon: Zap,      color: "text-emerald-400" },
  { id: "AGENT",      label: "AGENT",     icon: Cpu,      color: "text-violet-400"  },
  { id: "RESEARCH",   label: "RESEARCH",  icon: Search,   color: "text-cyan-300"    },
];

// ── M-shaped living node canvas ───────────────────────────────
type Phase = "idle" | "thinking" | "streaming";

function useMCanvas(ref: React.RefObject<HTMLCanvasElement>, phase: Phase) {
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let W = 0, H = 0;

    type Node = {
      homeX: number; homeY: number;
      x: number; y: number;
      vx: number; vy: number;
      r: number; osc: number; pathIdx: number;
    };

    let nodes: Node[] = [];

    // Nodes per segment: left-leg, inner-left-diagonal, inner-right-diagonal, right-leg
    const PER_SEG = [52, 44, 44, 52];
    // Extra "halo" nodes scattered around each segment for neural-cluster density
    const HALO_PER_SEG = [40, 32, 32, 40];

    const buildNodes = () => {
      nodes = [];

      const mx = W * 0.10;
      const my = H * 0.09;
      const mW = W * 0.80;
      const mH = H * 0.80;

      const pts = [
        { x: mx,          y: my + mH         }, // 0 BL
        { x: mx,          y: my              }, // 1 TL
        { x: mx + mW / 2, y: my + mH * 0.56  }, // 2 Valley
        { x: mx + mW,     y: my              }, // 3 TR
        { x: mx + mW,     y: my + mH         }, // 4 BR
      ];

      const segs: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4]];
      const segLens = segs.map(([a, b]) => {
        const dx = pts[b].x - pts[a].x;
        const dy = pts[b].y - pts[a].y;
        return Math.sqrt(dx * dx + dy * dy);
      });
      const totalLen = segLens.reduce((s, l) => s + l, 0);

      const jitterX = W * 0.005;
      const jitterY = H * 0.005;
      const haloX   = W * 0.040;
      const haloY   = H * 0.040;
      let cumLen = 0;

      for (let s = 0; s < segs.length; s++) {
        const [ai, bi] = segs[s];
        const from = pts[ai];
        const to   = pts[bi];
        const n    = PER_SEG[s];

        // Spine — thick, bright nodes that form the stroke of the M
        for (let i = 0; i < n; i++) {
          const t  = (i + 0.5) / n;
          const hx = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * jitterX * 2;
          const hy = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * jitterY;
          nodes.push({
            homeX: hx, homeY: hy,
            x: hx + (Math.random() - 0.5) * 28,
            y: hy + (Math.random() - 0.5) * 28,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            r: 5.5 + Math.random() * 5.0,
            osc: Math.random() * Math.PI * 2,
            pathIdx: (cumLen + t * segLens[s]) / totalLen,
          });
        }

        // Halo — satellite nodes around the spine for neural-cluster density
        const h = HALO_PER_SEG[s];
        for (let i = 0; i < h; i++) {
          const t  = Math.random();
          const hx = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * haloX * 2;
          const hy = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * haloY * 2;
          nodes.push({
            homeX: hx, homeY: hy,
            x: hx + (Math.random() - 0.5) * 20,
            y: hy + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            r: 3.0 + Math.random() * 3.5,
            osc: Math.random() * Math.PI * 2,
            pathIdx: (cumLen + t * segLens[s]) / totalLen,
          });
        }

        cumLen += segLens[s];
      }
    };

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf: number;
    let t = 0;

    const frame = () => {
      t += 0.013;
      const p         = phaseRef.current;
      const active    = p !== "idle";
      const streaming = p === "streaming";
      const thinking  = p === "thinking";

      ctx.clearRect(0, 0, W, H);

      const waveSpeed = streaming ? 0.50 : thinking ? 0.22 : 0;
      const wavePos   = active ? (t * waveSpeed) % 1 : -3;
      const N = nodes.length;

      for (const n of nodes) {
        n.vx += (n.homeX - n.x) * 0.017;
        n.vy += (n.homeY - n.y) * 0.017;
        if (active) {
          const mag = streaming ? 0.42 : 0.15;
          n.vx += (Math.random() - 0.5) * mag;
          n.vy += (Math.random() - 0.5) * mag;
        }
        n.vx *= 0.87;
        n.vy *= 0.87;
        n.x  += n.vx;
        n.y  += n.vy;
        n.osc += streaming ? 0.024 : 0.013;
      }

      // Connections — denser web, brighter base so the M reads as a neural cluster
      const maxD = active ? 320 : 260;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx   = nodes[i].x - nodes[j].x;
          const dy   = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= maxD) continue;

          const base = (1 - dist / maxD) * (active ? 0.85 : 0.60);
          const diI  = (nodes[i].pathIdx - wavePos) * 6.5;
          const diJ  = (nodes[j].pathIdx - wavePos) * 6.5;
          const wI   = Math.exp(-(diI * diI));
          const wJ   = Math.exp(-(diJ * diJ));
          const wb   = active ? (wI + wJ) * 0.55 : 0;
          const a    = Math.min(1.0, base + wb);

          ctx.beginPath();
          ctx.strokeStyle = `rgba(250,189,47,${a.toFixed(3)})`;
          ctx.lineWidth   = active ? 3.5 : 2.6;
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }

      // Nodes + radial glow
      for (const n of nodes) {
        const dn     = (n.pathIdx - wavePos) * 6.5;
        const wave   = Math.exp(-(dn * dn));
        const pulse  = 0.95 + 0.32 * Math.sin(n.osc + t);
        const alpha  = Math.min(1, pulse + (active ? 0.55 : 0.22) + wave * 2.6);
        const radius = n.r * (1 + wave * 1.45);

        if (wave > 0.10 && active) {
          const gr   = radius * 12.0;
          const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, gr);
          grad.addColorStop(0,    `rgba(250,189,47,${(wave * 0.85).toFixed(3)})`);
          grad.addColorStop(0.45, `rgba(250,189,47,${(wave * 0.22).toFixed(3)})`);
          grad.addColorStop(1,    "rgba(250,189,47,0)");
          ctx.beginPath();
          ctx.arc(n.x, n.y, gr, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(250,189,47,${alpha.toFixed(3)})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Waveform ─────────────────────────────────────────────────
function Waveform({ phase }: { phase: Phase }) {
  const BARS = 28;
  const props = useMemo(
    () =>
      Array.from({ length: BARS }, (_, i) => ({
        base:  3 + Math.abs(Math.sin(i * 0.65)) * 4,
        peak:  10 + Math.abs(Math.sin(i * 1.05 + 0.4)) * 22,
        dur:   0.28 + (i % 8) * 0.04,
        delay: i * 0.022,
      })),
    [],
  );

  return (
    <div className="flex items-end justify-center gap-[2.5px] h-8 opacity-80">
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
            animate={{ height: h, opacity: phase === "idle" ? 0.22 : phase === "thinking" ? 0.9 : 0.65 }}
            transition={{ duration: phase === "thinking" ? b.dur * 0.65 : b.dur, repeat: Infinity, delay: b.delay, ease: "easeInOut" }}
          />
        );
      })}
    </div>
  );
}

// ── Live clock ───────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return now;
}

// ── System stats ─────────────────────────────────────────────
function useStats(active: boolean) {
  const [s, setS] = useState({ cpu: 4, ram: 16, latency: 18, sync: 94 });
  const ar = useRef(active);
  useEffect(() => { ar.current = active; }, [active]);
  useEffect(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const rnd   = (r: number) => (Math.random() - 0.5) * r;
    const id = setInterval(() => {
      const a = ar.current;
      setS(p => ({
        cpu:     clamp(p.cpu     + rnd(a ? 7 : 2),   1,  a ? 48 : 12),
        ram:     clamp(p.ram     + rnd(1.5),          12, 28),
        latency: clamp(p.latency + rnd(a ? 22 : 5),  8,  a ? 130 : 38),
        sync:    clamp(p.sync    + rnd(0.9),          87, 99),
      }));
    }, 2200);
    return () => clearInterval(id);
  }, []);
  return s;
}

// ── Message row ──────────────────────────────────────────────
function MessageRow({ msg, isStreaming }: { msg: any; isStreaming: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-xs sm:max-w-sm text-[12px] font-mono text-amber-400/55 bg-amber-400/4 border border-amber-400/10 rounded-sm px-3 py-1.5 leading-5">
          <span className="text-amber-400/30 mr-1.5 select-none">›_</span>{msg.content}
        </div>
      </div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="w-full">
      <p
        className="text-[13px] sm:text-[14px] leading-7 text-white/88 whitespace-pre-wrap text-center sm:text-left"
        style={{ fontFamily: "'Share Tech Mono', monospace" }}
      >
        {msg.content}
        {isStreaming && (
          <motion.span
            className="inline-block w-[2px] h-[1em] bg-amber-400 ml-[2px] align-middle"
            animate={{ opacity: [1, 0] }} transition={{ duration: 0.45, repeat: Infinity }}
          />
        )}
      </p>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function MavisDemo() {
  const _appData = useAppData() as any;
  const {
    profile, quests, tasks, skills, journalEntries, vaultEntries,
    chatMessages, setChatMessages, conversationId, setConversationId,
    chatMode, setChatMode, refetchAll,
    rituals, councils, energySystems, inventory, allies, bpmSessions, storeItems, transformations,
  } = _appData;

  const [input,        setInput]        = useState("");
  const [isLoading,    setIsLoading]    = useState(false);
  const [voiceOpen,    setVoiceOpen]    = useState(false);
  const [showModes,    setShowModes]    = useState(false);
  const [dbLoaded,     setDbLoaded]     = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [streamingId,  setStreamingId]  = useState<string | null>(null);
  const [isSyncing,    setIsSyncing]    = useState(false);

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const messagesRef  = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const now   = useClock();
  const stats = useStats(isLoading);

  const canvasPhase: Phase = streamingId ? "streaming" : isLoading ? "thinking" : "idle";
  useMCanvas(canvasRef, canvasPhase);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [chatMessages]);

  // ── Register action handlers (same as MavisChat) ──────────
  useEffect(() => {
    setDefaultHandler(async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");
      const { data: actionData, error } = await supabase.functions.invoke("mavis-actions", {
        body: { actions: [payload] },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      const failed = Array.isArray(actionData?.results) ? actionData.results.filter((r: any) => r?.success === false) : [];
      if (failed.length > 0) throw new Error(failed.map((r: any) => `${r.type}: ${r.error}`).join(" | "));
    });

    registerActionHandler("propose_product", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      await supabase.from("mavis_tasks").insert({ user_id: session.user.id, type: "create_product", description: `Product proposal: "${payload.title}"`, payload: payload as any, status: "requires_confirmation" } as any);
    });

    registerActionHandler("nora_tweet", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      await supabase.from("mavis_tasks").insert({ user_id: session.user.id, type: "nora_tweet", description: `Nora tweet: "${String(payload.content).slice(0, 60)}…"`, payload: payload as any, status: "requires_confirmation" } as any);
    });

    registerActionHandler("create_skill_definition", async (payload) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      await supabase.from("mavis_skill_definitions").upsert({ user_id: session.user.id, name: payload.name, description: payload.description, keywords: payload.keywords, prompt_template: payload.prompt_template, is_active: true, updated_at: new Date().toISOString() } as any, { onConflict: "user_id,name" });
    });
  }, []);

  // ── Init session + load conversation from DB ──────────────
  useEffect(() => {
    if (dbLoaded) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setDbLoaded(true); return; }

        initSession(session.user.id);
        loadRuntimeSkills(session.user.id).catch(() => {});

        const { data: convos } = await supabase
          .from("chat_conversations").select("id").eq("user_id", session.user.id)
          .order("updated_at", { ascending: false }).limit(1);

        if (!convos?.length) { setDbLoaded(true); return; }
        const convoId = convos[0].id;

        const { data: msgs } = await supabase
          .from("chat_messages").select("*")
          .eq("conversation_id", convoId).eq("user_id", session.user.id)
          .order("created_at", { ascending: true }).limit(200);

        if (msgs?.length) {
          setChatMessages(msgs.map((m: any) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, mode: m.mode ?? "PRIME", timestamp: new Date(m.created_at) })));
          setConversationId(convoId);
        }
      } catch { /* non-critical */ }
      finally { setDbLoaded(true); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist a message ────────────────────────────────────
  const persistMessage = useCallback(async (msg: { role: string; content: string; mode?: string }, convoId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      await supabase.from("chat_messages").insert({ conversation_id: convoId, user_id: session.user.id, role: msg.role, content: msg.content, mode: msg.mode ?? "PRIME" });
    } catch { /* non-critical */ }
  }, []);

  // ── Ensure conversation exists ───────────────────────────
  const ensureConversation = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;
      if (conversationId) return conversationId;
      const { data, error } = await supabase.from("chat_conversations")
        .insert({ user_id: session.user.id, title: `MAVIS Thread — ${new Date().toLocaleDateString()}` })
        .select("id").single();
      if (error) throw error;
      setConversationId(data.id);
      return data.id;
    } catch { return null; }
  }, [conversationId, setConversationId]);

  // ── Send message — full MAVIS pipeline ───────────────────
  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;

    setInput("");
    cancelledRef.current = false;
    setIsLoading(true);
    setActionStatus(null);

    const userMsg = { id: `u-${Date.now()}`, role: "user" as const, content, mode: chatMode, timestamp: new Date() };
    setChatMessages((prev: any[]) => [...prev, userMsg]);

    const convoId = await ensureConversation();
    if (convoId) persistMessage({ role: "user", content, mode: chatMode }, convoId).catch(() => {});

    const history = chatMessages.filter((m: any) => m.id !== "init").slice(-18).map((m: any) => ({ role: m.role, content: m.content }));

    const { data: { session: authSession } } = await supabase.auth.getSession();
    const userId = authSession?.user?.id;

    const [fullCtx, memoriesRes, , , recallCtxRaw] = await Promise.all([
      userId ? loadFullAppContext(userId) : Promise.resolve(null),
      (async () => {
        if (!userId) return "";
        try {
          const { data: memories } = await supabase.from("memories").select("title, content, metadata, created_at")
            .eq("user_id", userId).or("source.eq.mavis_chat_clear,source.eq.mavis_auto_memory,source.eq.council_chat_clear")
            .order("created_at", { ascending: false }).limit(5);
          return (memories ?? []).map((m: any) => `[${m.title}]\n${(m.metadata as any)?.topic_summary || m.content.slice(0, 1000)}`).join("\n---\n");
        } catch { return ""; }
      })(),
      userId ? gatherProviderContext(userId, content).catch(() => "") : Promise.resolve(""),
      Promise.resolve(null),
      userId ? buildRecallContext(userId, content, 3).catch(() => null) : Promise.resolve(null),
    ]);

    const archivedMemories = memoriesRes as string;

    const compactState = [
      ...(quests   || []).map((q: any) => `QUEST [${q.id}] "${q.title}" status:${q.status}`),
      ...(tasks    || []).map((t: any) => `TASK [${t.id}] "${t.title}" status:${t.status}`),
      ...(skills   || []).map((s: any) => `SKILL [${s.id}] "${s.name}"`),
      ...(councils || []).map((c: any) => `COUNCIL [${c.id}] "${c.name}"`),
      ...(allies   || []).map((a: any) => `ALLY [${a.id}] "${a.name}"`),
    ].join("\n");

    const sid = `streaming-${Date.now()}`;
    setStreamingId(sid);
    setChatMessages((prev: any[]) => [...prev, { id: sid, role: "assistant" as const, content: "", mode: chatMode, timestamp: new Date() }]);

    try {
      let systemPrompt = await (fullCtx
        ? buildSystemPromptFromSnapshot(chatMode, fullCtx, archivedMemories, [])
        : buildSystemPromptFromSnapshot(chatMode, ({
            profile: profile as any,
            quests: quests as any[], tasks: tasks as any[], skills: skills as any[],
            rankings: [], transformations: transformations as any[],
            journalEntries: journalEntries as any[], vaultEntries: vaultEntries as any[],
            councilMembers: councils as any[], inventory: inventory as any[],
            storeItems: storeItems as any[], energySystems: energySystems as any[],
            bpmSessions: bpmSessions as any[], allies: allies as any[],
            rituals: rituals as any[], pendingApprovals: [], loadedAt: new Date().toISOString(),
          } as any), archivedMemories, []));
      if (recallCtxRaw) systemPrompt += `\n\n${recallCtxRaw}`;

      const abortController = new AbortController();
      abortRef.current = abortController;

      const onToken = (_token: string, accumulated: string) => {
        if (cancelledRef.current) return;
        setChatMessages((prev: any[]) => prev.map((m: any) => m.id === sid ? { ...m, content: accumulated } : m));
      };

      const opts = { mode: chatMode, conversationId: convoId, appState: compactState, chatKind: "mavis", threadRef: "main", attachmentIds: [] };
      const result =
        chatMode === "AGENT"
          ? await streamAgentMessage(content, systemPrompt, history, opts, onToken, () => {}, abortController.signal)
          : chatMode === "RESEARCH"
          ? await streamResearchMessage(content, opts, onToken, abortController.signal)
          : await streamChatMessage(content, systemPrompt, history, opts, onToken, abortController.signal);

      if (cancelledRef.current) {
        setChatMessages((prev: any[]) => prev.filter((m: any) => m.id !== sid));
        return;
      }

      const { cleanText, executionResults, conversationId: newConvoId } = result;
      const confirmed = executionResults.filter((r) => r.status === "success");
      const pending   = executionResults.filter((r) => r.status === "pending_confirmation");
      const failed    = executionResults.filter((r) => r.status === "error");

      const finalMsg = { id: `a-${Date.now()}`, role: "assistant" as const, content: cleanText, mode: chatMode, timestamp: new Date() };
      setChatMessages((prev: any[]) => prev.filter((m: any) => m.id !== sid).concat(finalMsg));

      if (newConvoId) setConversationId(newConvoId);
      const persistId = newConvoId ?? convoId;
      if (persistId) persistMessage({ role: "assistant", content: cleanText, mode: chatMode }, persistId).catch(() => {});

      if (confirmed.length > 0) {
        await new Promise(r => setTimeout(r, 500));
        await refetchAll();
        if (userId) captureProceduralMemory(userId, content, confirmed).catch(() => {});
        setActionStatus(`✓ ${confirmed.map((r) => r.action.type).join(", ")}`);
        setTimeout(() => setActionStatus(null), 3000);
      } else if (failed.length > 0) {
        setActionStatus(`⚠ ${failed.length} action${failed.length > 1 ? "s" : ""} failed`);
        setTimeout(() => setActionStatus(null), 3000);
      } else if (pending.length > 0) {
        setActionStatus(`⏳ ${pending.length} pending`);
        setTimeout(() => setActionStatus(null), 4000);
      }
    } catch (err: any) {
      if (cancelledRef.current || err?.name === "AbortError") {
        setChatMessages((prev: any[]) => prev.filter((m: any) => m.id !== sid));
        return;
      }
      setChatMessages((prev: any[]) => prev.filter((m: any) => m.id !== sid).concat({
        id: `e-${Date.now()}`, role: "assistant" as const,
        content: "Signal degraded. MAVIS standing by.", mode: chatMode, timestamp: new Date(),
      }));
    } finally {
      setIsLoading(false);
      setStreamingId(null);
    }
  }, [input, isLoading, chatMode, chatMessages, conversationId, setChatMessages, setConversationId, refetchAll, ensureConversation, persistMessage, profile, quests, tasks, skills, journalEntries, vaultEntries, councils, energySystems, inventory, allies, bpmSessions, storeItems, transformations, rituals]);

  const lastBotMessage = useMemo(() => {
    const last = chatMessages.filter((m: any) => m.role === "assistant").at(-1);
    if (!last) return "";
    return typeof last.content === "string" ? last.content : "";
  }, [chatMessages]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    setIsLoading(false);
  };

  const currentMode = MODES.find(m => m.id === chatMode) ?? MODES[0];
  const ModeIcon    = currentMode.icon;
  const dateStr     = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr     = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // ── Fast scroll helpers ─────────────────────────────────
  const scrollToTop = useCallback(() => {
    messagesRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // ── OmniSync: archive full app state + condensed thread ─
  const handleOmniSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");

      const condensedComms = (chatMessages as any[])
        .filter((m: any) => m.id !== "init")
        .map((m: any) => `[${m.role === "user" ? "OP" : "MAVIS"}${m.mode ? `/${m.mode}` : ""}] ${String(m.content).slice(0, 200)}${String(m.content).length > 200 ? "…" : ""}`)
        .join("\n");

      const snapshotData = {
        profile: { ...(profile || {}) },
        quests:        (quests   || []).map((q: any) => ({ id: q.id, title: q.title, status: q.status, type: q.type, xp_reward: q.xp_reward })),
        skills:        (skills   || []).map((s: any) => ({ id: s.id, name: s.name, category: s.category, tier: s.tier, proficiency: s.proficiency })),
        energySystems: (energySystems || []).map((e: any) => ({ id: e.id, type: e.type, current_value: e.current_value, max: e.max_value })),
        councils:      (councils || []).map((c: any) => ({ id: c.id, name: c.name, role: c.role, class: c.class })),
        allies:        (allies   || []).map((a: any) => ({ id: a.id, name: a.name, relationship: a.relationship, affinity: a.affinity })),
        inventory:     (inventory|| []).map((i: any) => ({ id: i.id, name: i.name, type: i.type, rarity: i.rarity, quantity: i.quantity })),
        rituals:       (rituals  || []).map((r: any) => ({ id: r.id, name: r.name, streak: r.streak, completed: r.completed })),
        journalCount:  (journalEntries || []).length,
        vaultCount:    (vaultEntries   || []).length,
        storeItemCount:(storeItems     || []).length,
        bpmSessionCount:(bpmSessions   || []).length,
        timestamp: new Date().toISOString(),
      };

      const summary = `OmniSync @ Lv${profile?.level ?? "-"} [${profile?.rank ?? "-"}] | ${(quests||[]).filter((q:any)=>q.status==="active").length} active quests | ${(skills||[]).length} skills | ${(chatMessages||[]).length} msgs`;

      const { error } = await supabase.from("omnisync_snapshots").insert({
        user_id: session.user.id,
        snapshot_data: snapshotData as any,
        condensed_comms: condensedComms.slice(0, 10000),
        summary,
      } as any);
      if (error) throw error;
      toast.success("OmniSync complete — snapshot saved");
    } catch (err: any) {
      console.error("OmniSync error:", err);
      toast.error("OmniSync failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, chatMessages, profile, quests, skills, energySystems, councils, allies, inventory, rituals, journalEntries, vaultEntries, storeItems, bpmSessions]);

  // ── Clear: archive thread to memory, then reset ─────────
  const clearChat = useCallback(async () => {
    await handleOmniSync();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && (chatMessages || []).length > 0) {
        const memoryContent = (chatMessages as any[])
          .filter((m: any) => m.id !== "init")
          .map((m: any) => `[${m.role === "user" ? "OPERATOR" : "MAVIS"}] ${m.content}`)
          .join("\n\n");

        const topicSummary = (chatMessages as any[])
          .filter((m: any) => m.id !== "init")
          .slice(-20)
          .map((m: any) => `${m.role === "user" ? "OP" : "M"}: ${String(m.content).slice(0, 300)}`)
          .join("\n");

        await supabase.from("memories").insert({
          user_id: session.user.id,
          title: `MavisUI Thread — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
          content: memoryContent.slice(0, 50000),
          memory_type: "conversation",
          source: "mavis_chat_clear",
          tags: ["chat_thread", "archived", "mavisui", String(chatMode).toLowerCase()],
          metadata: {
            message_count: (chatMessages || []).length,
            modes_used: [...new Set((chatMessages as any[]).map((m: any) => m.mode).filter(Boolean))],
            cleared_at: new Date().toISOString(),
            topic_summary: topicSummary.slice(0, 5000),
          } as any,
        } as any);

        if (conversationId) {
          await supabase.from("chat_messages").delete().eq("conversation_id", conversationId).eq("user_id", session.user.id);
          await supabase.from("chat_conversations").delete().eq("id", conversationId).eq("user_id", session.user.id);
        }
      }
    } catch (err) {
      console.error("Memory save on clear failed:", err);
    }
    setChatMessages([]);
    setConversationId(null);
    toast.success("Thread archived — memories preserved");
  }, [handleOmniSync, chatMessages, chatMode, conversationId, setChatMessages, setConversationId]);


  return (
    <div
      className="relative h-full w-full overflow-hidden flex flex-col font-mono select-none"
      style={{ background: "hsl(228 55% 3%)" }}
    >
      {/* M-shaped node canvas — full background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: 1 }}
      />

      {/* Radial vignette — keeps text readable */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse 70% 65% at 50% 48%, transparent 20%, rgba(0,0,0,0.80) 100%)" }}
      />

      {/* Scan line */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute w-full h-[1px] bg-gradient-to-r from-transparent via-amber-400/12 to-transparent animate-scan" />
      </div>

      {/* ── HEADER ─────────────────────────────────────────── */}
      <header
        className="relative z-10 flex items-center gap-3 px-4 sm:px-6 py-2.5 border-b"
        style={{ borderColor: "rgba(250,189,47,0.10)", background: "rgba(0,0,0,0.62)" }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 mr-3">
          <div className="relative w-7 h-7 flex items-center justify-center">
            <div
              className={`absolute inset-0 rounded border border-amber-400/25 ${isLoading ? "animate-ping" : ""}`}
              style={{ animationDuration: "2s" }}
            />
            <div className="w-7 h-7 rounded border border-amber-400/50 flex items-center justify-center bg-amber-400/5">
              <div className={`w-2.5 h-2.5 rounded-sm bg-amber-400 ${isLoading ? "animate-pulse" : "opacity-80"}`} />
            </div>
          </div>
          <div>
            <span className="text-amber-400 font-display text-sm font-bold tracking-[0.3em]">MAVIS</span>
            <span className="text-[10px] text-white/20 tracking-[0.15em] ml-3 hidden sm:inline">
              MASTER ARTIFICIAL VANTARA INTELLIGENCE SYSTEM
            </span>
          </div>
        </div>

        {/* Mode selector */}
        <div className="relative">
          <button
            onClick={() => setShowModes(v => !v)}
            className={`flex items-center gap-1.5 text-[10px] font-mono font-medium border rounded px-2 py-1 transition-all ${currentMode.color} border-current/30 hover:bg-current/5`}
          >
            <ModeIcon size={10} />
            {currentMode.label}
            <ChevronDown size={8} className={showModes ? "rotate-180" : ""} style={{ transition: "transform 0.15s" }} />
          </button>
          <AnimatePresence>
            {showModes && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute top-full left-0 mt-1 z-50 rounded border border-white/10 py-1 grid grid-cols-2 gap-px"
                style={{ background: "rgba(5,5,15,0.97)", minWidth: "200px" }}
              >
                {MODES.map(m => {
                  const Icon = m.icon;
                  return (
                    <button key={m.id} onClick={() => { setChatMode(m.id); setShowModes(false); }}
                      className={`flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 hover:bg-white/5 transition-colors ${m.color} ${chatMode === m.id ? "opacity-100" : "opacity-50"}`}
                    >
                      <Icon size={9} />{m.label}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action status */}
        {actionStatus && (
          <span className="text-[10px] font-mono text-emerald-400/80 ml-1">{actionStatus}</span>
        )}

        <div className="flex-1" />

        {/* OmniSync + Clear */}
        <button
          onClick={handleOmniSync}
          disabled={isSyncing}
          title="OmniSync — archive snapshot"
          className="flex items-center gap-1 text-[10px] font-mono text-cyan-400/85 hover:text-cyan-300 border border-cyan-400/25 hover:border-cyan-400/55 rounded px-2 py-1 transition-all disabled:opacity-40"
        >
          {isSyncing
            ? <span className="w-2.5 h-2.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin block" />
            : <Database size={10} />}
          <span className="hidden sm:inline tracking-widest">OMNISYNC</span>
        </button>
        <button
          onClick={clearChat}
          title="Clear thread (archives to memory)"
          className="flex items-center gap-1 text-[10px] font-mono text-white/45 hover:text-red-400 border border-white/10 hover:border-red-400/40 rounded px-2 py-1 transition-all ml-2"
        >
          <Trash2 size={10} />
          <span className="hidden sm:inline tracking-widest">CLEAR</span>
        </button>


        {/* Clock */}
        <div className="text-center hidden md:block">
          <p className="text-[9px] text-white/30 tracking-widest uppercase">{dateStr}</p>
          <p className="text-amber-400/80 text-[11px] tracking-widest tabular-nums">{timeStr}</p>
        </div>

        {/* Status */}
        <div className="flex items-center gap-1.5 text-[10px] ml-3">
          <div className={`w-1.5 h-1.5 rounded-full ${isLoading ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
          <span className={`hidden sm:block tracking-widest ${isLoading ? "text-amber-400/80" : "text-emerald-400/80"}`}>
            {isLoading ? (streamingId ? "TRANSMITTING" : "PROCESSING") : "ONLINE"}
          </span>
        </div>
      </header>

      {/* ── MESSAGES ───────────────────────────────────────── */}
      <div
        ref={messagesRef}
        className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-8 py-4 flex flex-col gap-4 min-h-0"
        style={{ scrollbarWidth: "none" }}
      >
        {chatMessages.filter((m: any) => m.id !== "init").length === 0 && !isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
            <div className="w-10 h-[1px] bg-amber-400/20" />
            <p className="text-white/22 text-[10px] tracking-[0.35em] uppercase">Sovereign Intelligence Standing By</p>
            <p className="text-white/12 text-[9px] tracking-widest">Type a message or press the mic to begin</p>
            <div className="w-10 h-[1px] bg-amber-400/20" />
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
            {chatMessages.filter((m: any) => m.id !== "init").map((msg: any) => (
              <MessageRow key={msg.id} msg={msg} isStreaming={msg.id === streamingId} />
            ))}
            {isLoading && !streamingId && (
              <div className="flex items-center gap-1.5 py-2">
                {[0, 1, 2, 3].map(i => (
                  <motion.div key={i} className="w-1 h-1 rounded-full bg-amber-400"
                    animate={{ opacity: [0.15, 1, 0.15], scale: [0.7, 1.3, 0.7] }}
                    transition={{ duration: 0.85, repeat: Infinity, delay: i * 0.17 }} />
                ))}
                <span className="text-white/25 text-[10px] tracking-[0.3em] ml-1 animate-pulse">PROCESSING</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── INPUT ──────────────────────────────────────────── */}
      <div className="relative z-10 px-4 sm:px-8 pb-3 pt-2 flex flex-col items-center gap-2">
        <Waveform phase={canvasPhase} />

        <div className="w-full max-w-2xl">
          <div
            className={["relative flex items-end gap-3 rounded-sm border px-4 py-3 transition-all duration-400",
              isLoading
                ? "border-amber-400/35 shadow-[0_0_24px_rgba(250,189,47,0.12)]"
                : "border-white/8 hover:border-white/15 focus-within:border-amber-400/35 focus-within:shadow-[0_0_24px_rgba(250,189,47,0.10)]"].join(" ")}
            style={{ background: "rgba(0,0,0,0.62)" }}
          >
            <span className="text-amber-400/40 text-sm mb-0.5 shrink-0 select-none">›_</span>

            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={handleKey}
              disabled={isLoading}
              placeholder={isLoading ? "MAVIS is responding..." : "Transmit to MAVIS..."}
              rows={1}
              className="flex-1 bg-transparent text-[13px] text-white/85 placeholder:text-white/18 resize-none outline-none leading-6"
              style={{ scrollbarWidth: "none", fontFamily: "'Share Tech Mono', monospace", minHeight: "24px" }}
            />

            <button
              onClick={() => setVoiceOpen(true)}
              disabled={isLoading}
              title="Voice chat"
              className="shrink-0 w-8 h-8 rounded-sm flex items-center justify-center border border-amber-400/25 text-amber-400/60 hover:text-amber-400 hover:border-amber-400/55 hover:bg-amber-400/8 disabled:opacity-25 disabled:cursor-not-allowed transition-all"
            >
              <Mic size={14} />
            </button>

            {isLoading ? (
              <button onClick={handleCancel} title="Stop"
                className="shrink-0 w-8 h-8 rounded-sm flex items-center justify-center border border-red-400/30 text-red-400/70 hover:text-red-400 hover:border-red-400/55 hover:bg-red-400/8 transition-all">
                <Square size={12} />
              </button>
            ) : (
              <button onClick={() => sendMessage()} disabled={!input.trim()}
                className="shrink-0 w-8 h-8 rounded-sm flex items-center justify-center border border-amber-400/25 text-amber-400/60 hover:text-amber-400 hover:border-amber-400/55 hover:bg-amber-400/8 disabled:opacity-25 disabled:cursor-not-allowed transition-all">
                <Send size={14} />
              </button>
            )}
          </div>
          <p className="text-[9px] text-white/10 text-center tracking-[0.3em] uppercase mt-1">
            Enter to transmit · Shift+Enter for newline
          </p>
        </div>
      </div>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer
        className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-2 border-t text-[9px] tracking-widest"
        style={{ borderColor: "rgba(250,189,47,0.08)", background: "rgba(0,0,0,0.62)" }}
      >
        <div className="flex items-center gap-3 sm:gap-5 text-white/25">
          <span>CPU <span className="text-amber-400/45">{Math.round(stats.cpu)}%</span></span>
          <span>RAM <span className="text-amber-400/45">{Math.round(stats.ram)}%</span></span>
          <span className="hidden sm:inline">LATENCY <span className="text-amber-400/45">{Math.round(stats.latency)}ms</span></span>
          <span className="hidden md:inline">NET <span className="text-emerald-400/50">STABLE</span></span>
          <span className="hidden lg:inline">SYNC <span className="text-amber-400/45">{Math.round(stats.sync)}%</span></span>
        </div>
        <span className="text-white/10 tracking-[0.25em] text-[8px] uppercase">Powered by Vantara</span>
      </footer>

      {/* ── Voice overlay ──────────────────────────────────── */}
      <AnimatePresence>
        {voiceOpen && (
          <VoiceChatOverlay
            onClose={() => setVoiceOpen(false)}
            sendMessage={async (text) => { await sendMessage(text); }}
            lastBotMessage={lastBotMessage}
            isLoading={isLoading}
            externalAudio={false}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
