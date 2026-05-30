// ============================================================
// VANTARA.EXE — AnalyticsPage
// Habit analytics, pattern insights, streak leaderboard
// ============================================================
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BarChart2, Loader2, RefreshCw, CheckSquare, CheckCircle2, Circle, Eye, Cpu } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ─── Types ──────────────────────────────────────────────────
interface MavisInsight {
  id: string;
  title: string;
  content: string;
  category: string;
  severity: string;
  source: string;
  read_at: string | null;
  generated_at: string;
}

interface Ritual {
  id: string;
  name: string;
  streak?: number;
  recurrence?: string;
  current_streak?: number;
}

interface Task {
  id: string;
  title: string;
  recurrence?: string;
  streak?: number;
  current_streak?: number;
}

interface EnergySystem {
  id: string;
  name: string;
  current: number;
  max: number;
  type?: string;
}

interface JournalEntry {
  id: string;
  mood: string | null;
  created_at: string;
}

interface CompletionEntry {
  completed_at?: string;
  completed?: boolean;
  task_id?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  info: "text-cyan-400 border-cyan-800 bg-cyan-950/40",
  warning: "text-amber-400 border-amber-800 bg-amber-950/40",
  critical: "text-red-400 border-red-800 bg-red-950/40",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getLast30Days(): string[] {
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// ─── AnalyticsPage ──────────────────────────────────────────
export function AnalyticsPage() {
  const { session } = useAuth();

  // Insights
  const [insights, setInsights] = useState<MavisInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [runningAnalysis, setRunningAnalysis] = useState(false);

  // Streaks
  const [streaks, setStreaks] = useState<{ id: string; name: string; streak: number; type: string }[]>([]);
  const [streaksLoading, setStreaksLoading] = useState(true);

  // Completion grid
  const [completionData, setCompletionData] = useState<Record<string, Record<string, boolean>>>({});
  const [habitNames, setHabitNames] = useState<{ id: string; title: string }[]>([]);
  const [gridLoading, setGridLoading] = useState(true);

  // Energy
  const [energySystems, setEnergySystems] = useState<EnergySystem[]>([]);
  const [energyLoading, setEnergyLoading] = useState(true);

  // Mood
  const [moodCounts, setMoodCounts] = useState<Record<string, number>>({});
  const [moodLoading, setMoodLoading] = useState(true);

  // Tool usage
  interface ToolStat { name: string; calls: number; successes: number; avgMs: number; }
  const [toolStats, setToolStats] = useState<ToolStat[]>([]);
  const [toolLoading, setToolLoading] = useState(true);

  const days30 = getLast30Days();

  useEffect(() => {
    if (!session) return;
    loadInsights();
    loadStreaks();
    loadCompletionGrid();
    loadEnergy();
    loadMood();
    loadToolStats();
  }, [session]);

  // ─── Loaders ───────────────────────────────────────────────
  async function loadInsights() {
    setInsightsLoading(true);
    const { data } = await supabase
      .from("mavis_insights")
      .select("*")
      .order("generated_at", { ascending: false })
      .limit(10);
    setInsights(data || []);
    setInsightsLoading(false);
  }

  async function loadToolStats() {
    setToolLoading(true);
    const { data } = await (supabase as any)
      .from("mavis_tool_executions")
      .select("tool_name, success, duration_ms")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!data) { setToolLoading(false); return; }
    const map: Record<string, { calls: number; successes: number; totalMs: number }> = {};
    for (const row of data) {
      const n = row.tool_name as string;
      if (!map[n]) map[n] = { calls: 0, successes: 0, totalMs: 0 };
      map[n].calls++;
      if (row.success) map[n].successes++;
      if (row.duration_ms) map[n].totalMs += row.duration_ms;
    }
    const stats = Object.entries(map)
      .map(([name, s]) => ({ name, calls: s.calls, successes: s.successes, avgMs: s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0 }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 12);
    setToolStats(stats);
    setToolLoading(false);
  }

  async function loadStreaks() {
    setStreaksLoading(true);
    const [ritualsRes, tasksRes] = await Promise.all([
      supabase.from("rituals").select("id, name, current_streak, streak").order("id"),
      supabase.from("tasks").select("id, title, current_streak, streak, recurrence").neq("recurrence", "once"),
    ]);
    const ritualItems = (ritualsRes.data || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      streak: r.current_streak ?? r.streak ?? 0,
      type: "ritual",
    }));
    const taskItems = (tasksRes.data || []).map((t: any) => ({
      id: t.id,
      name: t.title,
      streak: t.current_streak ?? t.streak ?? 0,
      type: "task",
    }));
    const all = [...ritualItems, ...taskItems].sort((a, b) => b.streak - a.streak).slice(0, 10);
    setStreaks(all);
    setStreaksLoading(false);
  }

  async function loadCompletionGrid() {
    setGridLoading(true);
    const since = days30[0];
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, title, recurrence")
      .in("recurrence", ["daily", "weekly"]);

    if (!tasks || tasks.length === 0) { setGridLoading(false); return; }

    const taskIds = tasks.map((t: any) => t.id);
    const { data: completions } = await supabase
      .from("task_completions")
      .select("task_id, completed_at")
      .in("task_id", taskIds)
      .gte("completed_at", since);

    const byTaskByDay: Record<string, Record<string, boolean>> = {};
    for (const t of tasks as any[]) {
      byTaskByDay[t.id] = {};
    }
    for (const c of (completions || []) as any[]) {
      const day = c.completed_at?.slice(0, 10);
      if (day && byTaskByDay[c.task_id] !== undefined) {
        byTaskByDay[c.task_id][day] = true;
      }
    }

    setHabitNames(tasks.map((t: any) => ({ id: t.id, title: t.title })));
    setCompletionData(byTaskByDay);
    setGridLoading(false);
  }

  async function loadEnergy() {
    setEnergyLoading(true);
    const { data } = await supabase.from("energy_systems").select("*");
    setEnergySystems(data || []);
    setEnergyLoading(false);
  }

  async function loadMood() {
    setMoodLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data } = await supabase
      .from("journal_entries")
      .select("mood, created_at")
      .gte("created_at", since.toISOString())
      .not("mood", "is", null);
    const counts: Record<string, number> = {};
    for (const e of (data || []) as JournalEntry[]) {
      if (e.mood) counts[e.mood] = (counts[e.mood] || 0) + 1;
    }
    setMoodCounts(counts);
    setMoodLoading(false);
  }

  // ─── Actions ───────────────────────────────────────────────
  async function markInsightRead(id: string) {
    await supabase.from("mavis_insights").update({ read_at: new Date().toISOString() }).eq("id", id);
    setInsights((prev) => prev.map((ins) => ins.id === id ? { ...ins, read_at: new Date().toISOString() } : ins));
  }

  async function runPatternAnalysis() {
    if (!session) return;
    setRunningAnalysis(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mavis-pattern-insights`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Pattern analysis complete — refreshing insights...");
      setTimeout(loadInsights, 1500);
    } catch (e: any) {
      toast.error(e.message || "Analysis failed");
    } finally {
      setRunningAnalysis(false);
    }
  }

  // ─── Energy color ──────────────────────────────────────────
  function energyBarColor(type?: string) {
    const map: Record<string, string> = {
      physical: "bg-green-500",
      mental: "bg-blue-500",
      creative: "bg-purple-500",
      social: "bg-amber-500",
      spiritual: "bg-cyan-500",
    };
    return map[type || ""] || "bg-primary";
  }

  // ─── Mood emoji map ────────────────────────────────────────
  function moodLabel(m: string) {
    const map: Record<string, string> = {
      great: "😊 Great", good: "🙂 Good", okay: "😐 Okay", neutral: "😐 Neutral",
      low: "😔 Low", bad: "😞 Bad", anxious: "😟 Anxious", motivated: "🔥 Motivated",
      tired: "😴 Tired", focused: "🎯 Focused",
    };
    return map[m.toLowerCase()] || m;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Habit patterns, insights, energy trends"
        icon={<BarChart2 size={18} />}
      />

      {/* ── Section 1: MAVIS Insights ───────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest">MAVIS Insights</h2>
          <button
            onClick={runPatternAnalysis}
            disabled={runningAnalysis}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            {runningAnalysis ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Run Pattern Analysis
          </button>
        </div>
        {insightsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : insights.length === 0 ? (
          <HudCard><p className="text-xs font-mono text-muted-foreground text-center py-4">No insights yet. Run pattern analysis.</p></HudCard>
        ) : (
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <motion.div key={ins.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                <HudCard className={ins.read_at ? "opacity-60" : ""}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${SEVERITY_STYLES[ins.severity] ?? SEVERITY_STYLES.info}`}>
                          {ins.severity}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground uppercase">{ins.category}</span>
                        <span className="text-[9px] font-mono text-muted-foreground ml-auto">{formatDate(ins.generated_at)}</span>
                      </div>
                      <p className="text-sm font-display font-bold mb-0.5">{ins.title}</p>
                      <p className="text-xs text-muted-foreground">{ins.content}</p>
                    </div>
                    {!ins.read_at && (
                      <button
                        onClick={() => markInsightRead(ins.id)}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-muted-foreground border border-border rounded hover:text-foreground transition-colors"
                      >
                        <Eye size={9} /> Read
                      </button>
                    )}
                    {ins.read_at && <CheckCircle2 size={12} className="text-green-500/50 shrink-0 mt-0.5" />}
                  </div>
                </HudCard>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Streak Leaderboard ───────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Streak Leaderboard</h2>
        {streaksLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : streaks.length === 0 ? (
          <HudCard><p className="text-xs font-mono text-muted-foreground text-center py-4">No streak data yet.</p></HudCard>
        ) : (
          <HudCard>
            <div className="space-y-2">
              {streaks.map((s, idx) => (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-muted-foreground w-5 text-right shrink-0">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono truncate">{s.name}</span>
                      <span className="text-[8px] font-mono text-muted-foreground uppercase">{s.type}</span>
                    </div>
                    <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (s.streak / (streaks[0]?.streak || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs font-display font-bold text-primary shrink-0">{s.streak}d</span>
                </div>
              ))}
            </div>
          </HudCard>
        )}
      </section>

      {/* ── Section 3: Habit Completion Grid ────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">30-Day Completion Grid</h2>
        {gridLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : habitNames.length === 0 ? (
          <HudCard><p className="text-xs font-mono text-muted-foreground text-center py-4">No recurring habits found.</p></HudCard>
        ) : (
          <HudCard className="overflow-x-auto">
            <div className="min-w-max space-y-2">
              {/* Day headers (every 5th) */}
              <div className="flex items-center gap-1">
                <div className="w-28 shrink-0" />
                {days30.map((d, i) => (
                  <div key={d} className="w-3 text-center">
                    {i % 5 === 0 && (
                      <span className="text-[7px] font-mono text-muted-foreground/50" style={{ writingMode: "vertical-lr" }}>
                        {new Date(d).getDate()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {habitNames.slice(0, 12).map((h) => (
                <div key={h.id} className="flex items-center gap-1">
                  <span className="text-[10px] font-mono text-muted-foreground truncate w-28 shrink-0">{h.title}</span>
                  {days30.map((d) => {
                    const done = completionData[h.id]?.[d];
                    const isPast = new Date(d) < new Date(new Date().toDateString());
                    return (
                      <div
                        key={d}
                        title={`${h.title} — ${d}`}
                        className={`w-3 h-3 rounded-sm shrink-0 ${
                          done ? "bg-green-500/80" : isPast ? "bg-red-900/40" : "bg-muted/30"
                        }`}
                      />
                    );
                  })}
                </div>
              ))}
              {/* Legend */}
              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30">
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-green-500/80" /><span className="text-[9px] font-mono text-muted-foreground">Done</span></div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-red-900/40" /><span className="text-[9px] font-mono text-muted-foreground">Missed</span></div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-muted/30" /><span className="text-[9px] font-mono text-muted-foreground">Future</span></div>
              </div>
            </div>
          </HudCard>
        )}
      </section>

      {/* ── Section 4: Energy Trends ─────────────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Energy Systems</h2>
        {energyLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : energySystems.length === 0 ? (
          <HudCard><p className="text-xs font-mono text-muted-foreground text-center py-4">No energy systems configured.</p></HudCard>
        ) : (
          <HudCard>
            <div className="space-y-3">
              {energySystems.map((e) => {
                const pct = e.max > 0 ? Math.min(100, Math.round((e.current / e.max) * 100)) : 0;
                const barColor = energyBarColor(e.type);
                return (
                  <div key={e.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono">{e.name}</span>
                        {e.type && <span className="text-[8px] font-mono text-muted-foreground uppercase">{e.type}</span>}
                      </div>
                      <span className="text-xs font-display font-bold text-primary">{e.current}/{e.max}</span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-right text-[9px] font-mono text-muted-foreground">{pct}%</div>
                  </div>
                );
              })}
            </div>
          </HudCard>
        )}
      </section>

      {/* ── Section 5: Journal Mood Chart ────────────────────── */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Journal Mood — Last 30 Days</h2>
        {moodLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : Object.keys(moodCounts).length === 0 ? (
          <HudCard><p className="text-xs font-mono text-muted-foreground text-center py-4">No mood data in the last 30 days.</p></HudCard>
        ) : (
          <HudCard>
            <div className="space-y-2">
              {Object.entries(moodCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([mood, count]) => {
                  const maxCount = Math.max(...Object.values(moodCounts));
                  const pct = Math.round((count / maxCount) * 100);
                  return (
                    <div key={mood} className="flex items-center gap-3">
                      <span className="text-xs font-mono w-32 shrink-0">{moodLabel(mood)}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-display font-bold text-primary w-8 text-right shrink-0">x{count}</span>
                    </div>
                  );
                })}
            </div>
          </HudCard>
        )}
      </section>

      {/* Tool Usage Dashboard */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3 flex items-center gap-2">
          <Cpu size={12} /> MAVIS Tool Usage
        </h2>
        {toolLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : toolStats.length === 0 ? (
          <HudCard><p className="text-xs font-mono text-muted-foreground text-center py-4">No tool executions recorded yet.</p></HudCard>
        ) : (
          <HudCard>
            <ResponsiveContainer width="100%" height={toolStats.length * 28 + 20}>
              <BarChart layout="vertical" data={toolStats} margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 9, fontFamily: "monospace" }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 9, fontFamily: "monospace" }} />
                <Tooltip
                  formatter={(val: number) => [val, "calls"]}
                  contentStyle={{ fontSize: 10, fontFamily: "monospace", background: "var(--background)", border: "1px solid var(--border)" }}
                />
                <Bar dataKey="calls" radius={[0, 3, 3, 0]}>
                  {toolStats.map((_, i) => (
                    <Cell key={i} fill={`hsl(${260 + i * 8}, 70%, 55%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 border-t border-border/30 pt-3 overflow-x-auto">
              <table className="w-full text-[9px] font-mono">
                <thead><tr className="text-muted-foreground"><th className="text-left pb-1">Tool</th><th className="text-right pb-1">Calls</th><th className="text-right pb-1">Success%</th><th className="text-right pb-1">Avg ms</th></tr></thead>
                <tbody>
                  {toolStats.map((t) => (
                    <tr key={t.name} className="border-t border-border/10">
                      <td className="py-0.5 pr-4 text-foreground/80">{t.name}</td>
                      <td className="text-right">{t.calls}</td>
                      <td className="text-right">{t.calls > 0 ? Math.round((t.successes / t.calls) * 100) : 0}%</td>
                      <td className="text-right">{t.avgMs > 0 ? `${t.avgMs}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </HudCard>
        )}
      </section>
    </div>
  );
}
