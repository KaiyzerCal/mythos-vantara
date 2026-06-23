// ============================================================
// VANTARA.EXE — SystemHealthPage
// Tab 1: Feature Diagnostics — live health check of all systems
// Tab 2: Cron Jobs — autonomous intelligence engine monitor
// ============================================================
import { useState } from "react";
import {
  Activity, RefreshCw, Loader2, CheckCircle2, XCircle,
  Clock, AlertTriangle, Play, Zap, Brain, Globe, Network,
  TrendingUp, BarChart3, Heart, Users, Sparkles, BookOpen,
  Shield, Calendar, Stethoscope, Database, Cpu, Key, HardDrive,
  AlertCircle, MinusCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

// ── Types ────────────────────────────────────────────────────
interface TestResult {
  id: string;
  name: string;
  category: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  latency_ms: number;
}

interface DiagSummary {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  skip: number;
}

interface DiagResult {
  results: TestResult[];
  summary: DiagSummary;
  ran_at: string;
}

interface CronJob {
  id: string;
  name: string;
  fn: string;
  schedule: string;
  description: string;
  icon: React.ElementType;
  color: string;
}

// ── Cron job registry ────────────────────────────────────────
const CRON_JOBS: CronJob[] = [
  { id: "memory-embed",       fn: "mavis-memory-embed",        name: "Memory Embed",         schedule: "Every 10 min",   description: "Embeds new memories into vector store for semantic search",              icon: Brain,      color: "indigo" },
  { id: "ambient-monitor",    fn: "mavis-ambient-monitor",     name: "Ambient Monitor",      schedule: "Every 30 min",   description: "Watches patterns and generates proactive nudges",                         icon: Activity,   color: "cyan" },
  { id: "autonomous-runner",  fn: "mavis-autonomous-runner",   name: "Autonomous Runner",    schedule: "Every 30 min",   description: "Executes queued autonomous tasks and standing orders",                   icon: Zap,        color: "amber" },
  { id: "outcome-tracker",    fn: "mavis-outcome-tracker",     name: "Outcome Tracker",      schedule: "Daily 2am",      description: "Tracks goal progress and updates outcome metrics",                       icon: BarChart3,  color: "emerald" },
  { id: "market-radar",       fn: "mavis-market-radar",        name: "Market Radar",         schedule: "Daily 6:30am",   description: "Scans market signals and competitive intelligence",                      icon: TrendingUp, color: "amber" },
  { id: "performance-science",fn: "mavis-performance-science", name: "Performance Science",  schedule: "Daily 7am",      description: "Analyzes productivity and performance patterns",                          icon: BarChart3,  color: "blue" },
  { id: "entity-graph",       fn: "mavis-entity-graph",        name: "Entity Graph",         schedule: "Daily 4am",      description: "Extracts entities from conversations and builds knowledge graph",         icon: Network,    color: "purple" },
  { id: "narrative-engine",   fn: "mavis-narrative-engine",    name: "Narrative Engine",     schedule: "Sun 4am",        description: "Synthesizes weekly narrative arc from your patterns",                    icon: BookOpen,   color: "pink" },
  { id: "predictive-engine",  fn: "mavis-predictive-engine",  name: "Predictive Engine",    schedule: "Daily 5am",      description: "Generates behavioral predictions and upcoming-need alerts",              icon: Sparkles,   color: "violet" },
  { id: "causal-engine",      fn: "mavis-causal-engine",       name: "Causal Engine",        schedule: "Sun 2am",        description: "Runs causal inference on life patterns to surface root causes",         icon: Shield,     color: "red" },
  { id: "relationship-intel", fn: "mavis-relationship-intel",  name: "Relationship Intel",   schedule: "Mon 8am",        description: "Scores relationship health and generates reconnect nudges",               icon: Users,      color: "rose" },
  { id: "self-evolve",        fn: "mavis-self-evolve",         name: "Self-Evolve",          schedule: "Sun 3am",        description: "Analyses MAVIS's own performance and proposes improvements",             icon: RefreshCw,  color: "teal" },
  { id: "world-model",        fn: "mavis-world-model",         name: "World Model",          schedule: "Sun 5am",        description: "Builds a comprehensive model of your external environment",              icon: Globe,      color: "sky" },
  { id: "user-model-refresh", fn: "mavis-user-model-refresh",  name: "User Model Refresh",   schedule: "Daily 3am",      description: "Synthesizes behavioral model from memory and interaction history",       icon: Brain,      color: "indigo" },
  { id: "heartbeat",          fn: "mavis-heartbeat",           name: "Heartbeat",            schedule: "Every 20 min",   description: "Integration sync coordinator — Google, Spotify, Strava, RSS, Oura",    icon: Heart,      color: "green" },
  { id: "compound-learning",  fn: "mavis-compound-learning",   name: "Compound Learning",    schedule: "Daily 1am",      description: "Consolidates interaction signals into operator preferences",             icon: Sparkles,   color: "amber" },
  { id: "self-improve",       fn: "mavis-self-improve",        name: "Self-Improve",         schedule: "Weekly Sun 1am", description: "Scores conversations and exports training pairs for fine-tuning",       icon: Brain,      color: "cyan" },
  { id: "morning-brief",      fn: "mavis-morning-brief",       name: "Morning Brief",        schedule: "Daily 6am",      description: "Composes and delivers the daily morning intelligence brief",             icon: Calendar,   color: "orange" },
];

const COLOR_MAP: Record<string, { badge: string; btn: string; dot: string }> = {
  indigo:  { badge: "bg-indigo-500/10 border-indigo-500/30 text-indigo-400",    btn: "bg-indigo-500/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30",    dot: "bg-indigo-400" },
  cyan:    { badge: "bg-cyan-500/10 border-cyan-500/30 text-cyan-400",          btn: "bg-cyan-500/20 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30",             dot: "bg-cyan-400" },
  amber:   { badge: "bg-amber-500/10 border-amber-500/30 text-amber-400",       btn: "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30",         dot: "bg-amber-400" },
  emerald: { badge: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", btn: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30", dot: "bg-emerald-400" },
  blue:    { badge: "bg-blue-500/10 border-blue-500/30 text-blue-400",          btn: "bg-blue-500/20 border-blue-500/40 text-blue-300 hover:bg-blue-500/30",             dot: "bg-blue-400" },
  purple:  { badge: "bg-purple-500/10 border-purple-500/30 text-purple-400",    btn: "bg-purple-500/20 border-purple-500/40 text-purple-300 hover:bg-purple-500/30",     dot: "bg-purple-400" },
  pink:    { badge: "bg-pink-500/10 border-pink-500/30 text-pink-400",          btn: "bg-pink-500/20 border-pink-500/40 text-pink-300 hover:bg-pink-500/30",             dot: "bg-pink-400" },
  violet:  { badge: "bg-violet-500/10 border-violet-500/30 text-violet-400",    btn: "bg-violet-500/20 border-violet-500/40 text-violet-300 hover:bg-violet-500/30",     dot: "bg-violet-400" },
  red:     { badge: "bg-red-500/10 border-red-500/30 text-red-400",             btn: "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30",                 dot: "bg-red-400" },
  rose:    { badge: "bg-rose-500/10 border-rose-500/30 text-rose-400",          btn: "bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30",             dot: "bg-rose-400" },
  teal:    { badge: "bg-teal-500/10 border-teal-500/30 text-teal-400",          btn: "bg-teal-500/20 border-teal-500/40 text-teal-300 hover:bg-teal-500/30",             dot: "bg-teal-400" },
  sky:     { badge: "bg-sky-500/10 border-sky-500/30 text-sky-400",             btn: "bg-sky-500/20 border-sky-500/40 text-sky-300 hover:bg-sky-500/30",                 dot: "bg-sky-400" },
  green:   { badge: "bg-green-500/10 border-green-500/30 text-green-400",       btn: "bg-green-500/20 border-green-500/40 text-green-300 hover:bg-green-500/30",         dot: "bg-green-400" },
  orange:  { badge: "bg-orange-500/10 border-orange-500/30 text-orange-400",    btn: "bg-orange-500/20 border-orange-500/40 text-orange-300 hover:bg-orange-500/30",     dot: "bg-orange-400" },
};

// ── Diagnostics helpers ──────────────────────────────────────
const CATEGORY_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  "Core Tables":    { icon: Database, color: "text-blue-400",    label: "Core Tables" },
  "MAVIS Tables":   { icon: Brain,    color: "text-violet-400",  label: "MAVIS Intelligence" },
  "AI Providers":   { icon: Cpu,      color: "text-purple-400",  label: "AI Providers" },
  "Integrations":   { icon: Key,      color: "text-amber-400",   label: "Integrations" },
  "Storage":        { icon: HardDrive,color: "text-cyan-400",    label: "Storage" },
  "Auth":           { icon: Shield,   color: "text-emerald-400", label: "Auth" },
};

const STATUS_CONFIG = {
  pass: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", label: "PASS" },
  fail: { icon: XCircle,      color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20",         label: "FAIL" },
  warn: { icon: AlertCircle,  color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",     label: "WARN" },
  skip: { icon: MinusCircle,  color: "text-zinc-500",    bg: "bg-zinc-800/50 border-zinc-700/30",       label: "SKIP" },
};

interface TriggerResult {
  ok: boolean;
  data?: any;
  error?: string;
}

// ── Component ────────────────────────────────────────────────
export function SystemHealthPage() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const [tab, setTab] = useState<"diagnostics" | "cron">("diagnostics");

  // Diagnostics state
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState<DiagResult | null>(null);

  // Cron state
  const [triggering, setTriggering] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, TriggerResult>>({});

  // ── Run diagnostics ────────────────────────────────────────
  async function runDiagnostics() {
    if (!token) { toast.error("Not authenticated"); return; }
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const res = await fetch(`${SB_URL}/functions/v1/mavis-health-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setDiagResult(data);
        const { fail, warn, pass } = data.summary;
        if (fail > 0) toast.error(`${fail} test(s) failed — check diagnostics`);
        else if (warn > 0) toast.warning(`${warn} warning(s) — some integrations not configured`);
        else toast.success(`All ${pass} tests passed`);
      } else {
        toast.error(data?.error ?? "Diagnostics failed");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Network error");
    } finally {
      setDiagRunning(false);
    }
  }

  // ── Cron trigger ───────────────────────────────────────────
  async function trigger(job: CronJob) {
    if (!token) { toast.error("Not authenticated"); return; }
    setTriggering(t => ({ ...t, [job.id]: true }));
    try {
      const res = await fetch(`${SB_URL}/functions/v1/${job.fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`${job.name} triggered`);
        setResults(r => ({ ...r, [job.id]: { ok: true, data } }));
      } else {
        const msg = data?.error ?? `HTTP ${res.status}`;
        toast.error(`${job.name}: ${msg}`);
        setResults(r => ({ ...r, [job.id]: { ok: false, error: msg } }));
      }
    } catch (e: any) {
      toast.error(`${job.name}: ${e.message}`);
      setResults(r => ({ ...r, [job.id]: { ok: false, error: e.message } }));
    } finally {
      setTriggering(t => ({ ...t, [job.id]: false }));
    }
  }

  async function triggerAll() {
    if (!token) { toast.error("Not authenticated"); return; }
    const heavy = CRON_JOBS.filter(j => !["memory-embed", "ambient-monitor", "autonomous-runner", "heartbeat"].includes(j.id));
    toast.info("Triggering synthesis jobs…");
    for (const job of heavy) {
      trigger(job);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Diagnostics render helpers ────────────────────────────
  function renderDiagCategory(category: string, items: TestResult[]) {
    const meta = CATEGORY_META[category] ?? { icon: Activity, color: "text-zinc-400", label: category };
    const Icon = meta.icon;
    const passCount = items.filter(r => r.status === "pass").length;
    const failCount = items.filter(r => r.status === "fail").length;
    const warnCount = items.filter(r => r.status === "warn").length;

    return (
      <div key={category} className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl overflow-hidden">
        {/* Category header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-700/40 bg-zinc-900/40">
          <div className="flex items-center gap-2">
            <Icon size={14} className={meta.color} />
            <span className="text-xs font-mono font-semibold text-zinc-300 uppercase tracking-widest">{meta.label}</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            {failCount > 0 && <span className="text-red-400">{failCount} fail</span>}
            {warnCount > 0 && <span className="text-amber-400">{warnCount} warn</span>}
            <span className="text-emerald-400">{passCount}/{items.length}</span>
          </div>
        </div>
        {/* Test rows */}
        <div className="divide-y divide-zinc-800/60">
          {items.map(result => {
            const sc = STATUS_CONFIG[result.status];
            const SIcon = sc.icon;
            return (
              <div key={result.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/20 transition-colors">
                <SIcon size={14} className={sc.color + " shrink-0"} />
                <span className="text-sm text-zinc-200 flex-1 min-w-0">{result.name}</span>
                <span className="text-xs text-zinc-500 font-mono shrink-0 hidden sm:block">{result.message}</span>
                <div className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold ${sc.bg} ${sc.color}`}>
                  {sc.label}
                </div>
                <span className="text-[10px] font-mono text-zinc-600 shrink-0 w-14 text-right">{result.latency_ms}ms</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Group results by category (preserve declaration order)
  const categoryOrder = ["Auth", "Core Tables", "MAVIS Tables", "AI Providers", "Integrations", "Storage"];
  const grouped = categoryOrder
    .map(cat => ({
      cat,
      items: (diagResult?.results ?? []).filter(r => r.category === cat),
    }))
    .filter(g => g.items.length > 0);

  const overallHealth = diagResult
    ? diagResult.summary.fail === 0
      ? diagResult.summary.warn === 0 ? "pass" : "warn"
      : "fail"
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health"
        subtitle="Feature diagnostics and autonomous intelligence engine monitor"
        icon={<Activity size={18} />}
      />

      {/* ── Tabs ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-zinc-700/40 pb-0">
        {[
          { key: "diagnostics", label: "Feature Diagnostics", icon: Stethoscope },
          { key: "cron",        label: "Cron Jobs",           icon: Clock },
        ].map(t => {
          const TIcon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono border-b-2 transition-colors -mb-px ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <TIcon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* TAB: DIAGNOSTICS                                    */}
      {/* ═══════════════════════════════════════════════════ */}
      {tab === "diagnostics" && (
        <div className="space-y-4">
          {/* Summary / run button */}
          <div className="flex items-center justify-between gap-4">
            {diagResult ? (
              <div className="flex items-center gap-4">
                {[
                  { label: "Pass",  value: diagResult.summary.pass,  color: "text-emerald-400" },
                  { label: "Fail",  value: diagResult.summary.fail,  color: "text-red-400" },
                  { label: "Warn",  value: diagResult.summary.warn,  color: "text-amber-400" },
                  { label: "Skip",  value: diagResult.summary.skip,  color: "text-zinc-500" },
                  { label: "Total", value: diagResult.summary.total, color: "text-zinc-300" },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className={`text-2xl font-display font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">{s.label}</p>
                  </div>
                ))}
                {overallHealth && (
                  <div className={`ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-bold ${
                    overallHealth === "pass"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : overallHealth === "warn"
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                        : "bg-red-500/10 border-red-500/30 text-red-400"
                  }`}>
                    {overallHealth === "pass" ? <CheckCircle2 size={12} /> : overallHealth === "warn" ? <AlertCircle size={12} /> : <XCircle size={12} />}
                    {overallHealth === "pass" ? "All Systems Go" : overallHealth === "warn" ? "Warnings" : "Issues Found"}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 font-mono">
                Run diagnostics to check all MAVIS systems — databases, AI providers, integrations, and storage.
              </p>
            )}
            <button
              onClick={runDiagnostics}
              disabled={diagRunning}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-colors shrink-0"
            >
              {diagRunning
                ? <><Loader2 size={12} className="animate-spin" /> Running…</>
                : <><Stethoscope size={12} /> Run Diagnostics</>
              }
            </button>
          </div>

          {/* Ran-at timestamp */}
          {diagResult?.ran_at && (
            <p className="text-xs font-mono text-zinc-600">
              Last run: {new Date(diagResult.ran_at).toLocaleString()}
            </p>
          )}

          {/* Loading skeleton */}
          {diagRunning && (
            <div className="space-y-3">
              {["Core Tables", "MAVIS Intelligence", "AI Providers", "Integrations"].map(label => (
                <div key={label} className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-4 animate-pulse">
                  <div className="h-3 w-32 bg-zinc-700/50 rounded mb-3" />
                  {[1,2,3].map(i => (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <div className="h-3 w-3 bg-zinc-700/50 rounded-full" />
                      <div className="h-3 flex-1 bg-zinc-700/30 rounded" />
                      <div className="h-3 w-12 bg-zinc-700/30 rounded" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Results grouped by category */}
          {!diagRunning && diagResult && (
            <div className="space-y-3">
              {grouped.map(g => renderDiagCategory(g.cat, g.items))}
            </div>
          )}

          {/* Empty state */}
          {!diagRunning && !diagResult && (
            <HudCard>
              <div className="flex flex-col items-center py-12 gap-3 text-center">
                <Stethoscope size={32} className="text-zinc-700" />
                <p className="text-sm font-mono text-zinc-500">No diagnostics run yet</p>
                <p className="text-xs font-mono text-zinc-600 max-w-sm">
                  Click "Run Diagnostics" to check all MAVIS systems: database tables,
                  AI provider connectivity, integration keys, and storage.
                </p>
                <button
                  onClick={runDiagnostics}
                  className="mt-2 flex items-center gap-1.5 px-4 py-2 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                >
                  <Stethoscope size={12} /> Run Diagnostics
                </button>
              </div>
            </HudCard>
          )}

          <div className="bg-zinc-900/40 border border-zinc-700/30 rounded-xl p-3">
            <p className="text-xs text-zinc-500 font-mono">
              <AlertTriangle size={11} className="inline mr-1 text-amber-400" />
              All diagnostic tests are read-only. AI provider tests send minimal requests (5 tokens max).
              Integration checks only verify secret presence — no API calls made for those.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* TAB: CRON JOBS                                      */}
      {/* ═══════════════════════════════════════════════════ */}
      {tab === "cron" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="grid grid-cols-4 gap-3 flex-1 mr-4">
              {[
                { label: "Active Jobs",    value: CRON_JOBS.length,                                                                                    color: "text-primary" },
                { label: "High-Frequency", value: CRON_JOBS.filter(j => j.schedule.includes("min")).length,                                            color: "text-cyan-400" },
                { label: "Daily",          value: CRON_JOBS.filter(j => j.schedule.startsWith("Daily")).length,                                        color: "text-amber-400" },
                { label: "Weekly",         value: CRON_JOBS.filter(j => j.schedule.startsWith("Sun") || j.schedule.startsWith("Mon") || j.schedule.startsWith("Weekly")).length, color: "text-violet-400" },
              ].map(stat => (
                <HudCard key={stat.label}>
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
                  <p className={`text-2xl font-display font-bold ${stat.color}`}>{stat.value}</p>
                </HudCard>
              ))}
            </div>
            <button
              onClick={triggerAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 shrink-0"
            >
              <Zap size={12} /> Trigger All Synthesis
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CRON_JOBS.map(job => {
              const c = COLOR_MAP[job.color] ?? COLOR_MAP["indigo"];
              const Icon = job.icon;
              const isRunning = triggering[job.id];
              const result = results[job.id];

              return (
                <div key={job.id} className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-4 flex items-start gap-3">
                  <div className={`mt-0.5 w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${c.badge}`}>
                    <Icon size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-white">{job.name}</p>
                        <p className="text-xs text-zinc-500 font-mono">{job.schedule}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {result && (
                          result.ok
                            ? <CheckCircle2 size={14} className="text-emerald-400" />
                            : <XCircle size={14} className="text-red-400" />
                        )}
                        <button
                          onClick={() => trigger(job)}
                          disabled={isRunning}
                          className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border transition-colors ${c.btn} disabled:opacity-50`}
                        >
                          {isRunning ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                          Run
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{job.description}</p>
                    {result?.error && (
                      <p className="text-xs text-red-400 mt-1 truncate">{result.error}</p>
                    )}
                    {result?.ok && result.data && (
                      <p className="text-xs text-emerald-400 mt-1 truncate">
                        {result.data.refreshed !== undefined ? `Refreshed ${result.data.refreshed} user(s)` :
                         result.data.records_synced !== undefined ? `${result.data.records_synced} records` :
                         result.data.ok ? "Completed" : "Done"}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-zinc-900/40 border border-zinc-700/30 rounded-xl p-4">
            <p className="text-xs text-zinc-500 font-mono">
              <AlertTriangle size={11} className="inline mr-1 text-amber-400" />
              All jobs run autonomously via pg_cron. Manual triggers run them immediately on-demand. High-frequency jobs (heartbeat, ambient monitor) are safe to run anytime.
              Synthesis jobs (world model, narrative engine, etc.) may take 30-90 seconds and consume AI credits.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
