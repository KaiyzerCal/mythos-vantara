// ============================================================
// VANTARA.EXE — MAVIS Self-Evolution Page
// View evolution logs and trigger improvement cycles.
// ============================================================
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Zap, TrendingUp, TrendingDown, Trash2,
  Plus, Lightbulb, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Clock,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const supabase = _supabase as any;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

type EvolutionResult = {
  rules_strengthened: string[];
  rules_weakened: string[];
  rules_pruned: string[];
  rules_added: string[];
  insights: string[];
  triggered_at?: string;
};

type SectionKey = keyof Omit<EvolutionResult, "triggered_at">;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? "";
}

async function invoke(fn: string, body: object): Promise<any> {
  const token = await getToken();
  const res = await fetch(`${SB_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(err);
  }
  return res.json();
}

async function fetchLog(userId: string): Promise<EvolutionResult | null> {
  const token = await getToken();
  const res = await fetch(
    `${SB_URL}/functions/v1/mavis-self-evolve?user_id=${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
      },
    },
  );
  if (!res.ok) return null;
  return res.json();
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SECTION_CONFIG: Record<SectionKey, { icon: React.ElementType; label: string; color: string; bg: string }> = {
  rules_strengthened: { icon: TrendingUp,   label: "Strengthened", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  rules_weakened:     { icon: TrendingDown,  label: "Weakened",     color: "text-amber-400",   bg: "bg-amber-500/10   border-amber-500/30"   },
  rules_pruned:       { icon: Trash2,        label: "Pruned",       color: "text-red-400",     bg: "bg-red-500/10     border-red-500/30"     },
  rules_added:        { icon: Plus,          label: "New Rules",    color: "text-sky-400",     bg: "bg-sky-500/10     border-sky-500/30"     },
  insights:           { icon: Lightbulb,     label: "Insights",     color: "text-violet-400",  bg: "bg-violet-500/10  border-violet-500/30"  },
};

function ResultSection({ sectionKey, items }: { sectionKey: SectionKey; items: string[] }) {
  const [open, setOpen] = useState(true);
  const cfg = SECTION_CONFIG[sectionKey];
  const Icon = cfg.icon;

  if (!items.length) return null;

  return (
    <div className={`rounded border ${cfg.bg} overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <Icon size={14} className={cfg.color} />
        <span className={`text-xs font-mono font-medium ${cfg.color}`}>{cfg.label}</span>
        <span className="ml-auto text-xs text-muted-foreground font-mono">{items.length}</span>
        {open ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <ul className="px-3 pb-2 space-y-1">
              {items.map((item, i) => (
                <li key={i} className="text-xs text-foreground/80 font-mono leading-relaxed flex gap-2">
                  <span className={`${cfg.color} shrink-0 mt-0.5`}>›</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SelfEvolvePage() {
  const { user } = useAuth();
  const [log, setLog] = useState<EvolutionResult | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);
  const [evolving, setEvolving] = useState(false);

  const loadLog = useCallback(async () => {
    if (!user?.id) return;
    setLoadingLog(true);
    try {
      const result = await fetchLog(user.id);
      setLog(result);
    } catch {
      toast.error("Failed to load evolution log");
    } finally {
      setLoadingLog(false);
    }
  }, [user?.id]);

  const triggerEvolution = useCallback(async () => {
    if (!user?.id || evolving) return;
    setEvolving(true);
    toast.info("Evolution cycle started — this may take 60–120s with extended thinking…");
    try {
      const result = await invoke("mavis-self-evolve", { user_id: user.id });
      setLog({ ...result, triggered_at: new Date().toISOString() });
      toast.success("Evolution cycle complete");
    } catch (e: any) {
      toast.error(`Evolution failed: ${e.message}`);
    } finally {
      setEvolving(false);
    }
  }, [user?.id, evolving]);

  const totalChanges = log
    ? (log.rules_strengthened?.length ?? 0) +
      (log.rules_weakened?.length ?? 0) +
      (log.rules_pruned?.length ?? 0) +
      (log.rules_added?.length ?? 0)
    : 0;

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Brain size={18} className="text-violet-400" />
        </div>
        <div>
          <h1 className="font-display text-sm font-bold tracking-widest text-foreground">
            MAVIS SELF-EVOLUTION
          </h1>
          <p className="text-xs font-mono text-muted-foreground">
            Claude Opus · Extended Thinking · Confidence-Weighted Rule Updates
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={loadLog}
            disabled={loadingLog}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-xs font-mono text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={loadingLog ? "animate-spin" : ""} />
            Load Last Log
          </button>
          <button
            onClick={triggerEvolution}
            disabled={evolving || !user?.id}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded border border-violet-500/50 bg-violet-500/10 text-violet-300 text-xs font-mono font-medium hover:bg-violet-500/20 transition-colors disabled:opacity-40"
          >
            {evolving ? (
              <>
                <Brain size={13} className="animate-pulse" />
                Evolving…
              </>
            ) : (
              <>
                <Zap size={13} />
                Trigger Evolution
              </>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* How it works */}
        <div className="rounded border border-border/50 bg-muted/20 p-4 space-y-2">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">How it works</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { icon: "📚", title: "Reads Memory", desc: "mavis_tacit knowledge base" },
              { icon: "📊", title: "Reviews Outcomes", desc: "mavis_outcome_events log" },
              { icon: "🧠", title: "Extended Thinking", desc: "Claude Opus deep reasoning" },
              { icon: "⚡", title: "Updates Rules", desc: "Confidence-weighted changes" },
            ].map((s) => (
              <div key={s.title} className="rounded border border-border/40 bg-background/40 p-3">
                <p className="text-base mb-1">{s.icon}</p>
                <p className="text-xs font-mono font-medium text-foreground">{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Evolving state */}
        <AnimatePresence>
          {evolving && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded border border-violet-500/30 bg-violet-500/5 p-6 flex flex-col items-center gap-3"
            >
              <Brain size={32} className="text-violet-400 animate-pulse" />
              <p className="text-sm font-mono text-violet-300">Running extended-thinking evolution cycle…</p>
              <p className="text-xs text-muted-foreground font-mono">Reading tacit knowledge → analysing outcomes → updating rules</p>
              <div className="flex gap-1 mt-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-violet-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        {log && !evolving && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center gap-3 rounded border border-border bg-muted/20 px-4 py-3">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-mono text-foreground">
                  Evolution complete — <span className="text-primary">{totalChanges}</span> rule changes,{" "}
                  <span className="text-violet-400">{log.insights?.length ?? 0}</span> insights
                </p>
                {log.triggered_at && (
                  <p className="text-xs text-muted-foreground font-mono flex items-center gap-1 mt-0.5">
                    <Clock size={10} />
                    {new Date(log.triggered_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* Sections */}
            <div className="space-y-2">
              {(Object.keys(SECTION_CONFIG) as SectionKey[]).map((key) => (
                <ResultSection key={key} sectionKey={key} items={log[key] ?? []} />
              ))}
            </div>

            {totalChanges === 0 && !log.insights?.length && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono px-2">
                <AlertCircle size={14} />
                No changes this cycle — MAVIS is already well-calibrated.
              </div>
            )}
          </motion.div>
        )}

        {/* Empty state */}
        {!log && !evolving && !loadingLog && (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <Brain size={40} className="text-muted-foreground/40" />
            <p className="text-sm font-mono text-muted-foreground">No evolution log loaded</p>
            <p className="text-xs text-muted-foreground/60 max-w-sm">
              Click "Load Last Log" to fetch the most recent evolution run, or "Trigger Evolution" to run a new cycle.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
