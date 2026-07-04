// ============================================================
// VANTARA.EXE — TimeTrackingPage
// Log and track time per task / project with live timer
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Trash2, Play, Square, Loader2, Plus } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

// ─── Types ──────────────────────────────────────────────────
interface TimeLog {
  id: string;
  user_id: string;
  description: string;
  project: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tags: string[] | null;
  created_at: string;
}

interface ActiveTimer {
  description: string;
  project: string;
  startedAt: Date;
}

interface NewForm {
  description: string;
  project: string;
  tags: string;
}

// ─── Helpers ────────────────────────────────────────────────
function formatHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekStart(): Date {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── TimeTrackingPage ───────────────────────────────────────
export function TimeTrackingPage() {
  const { user } = useAuth();
  const { lastActionTs } = useAppData();

  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [timerDisplay, setTimerDisplay] = useState("00:00:00");
  const [newForm, setNewForm] = useState<NewForm>({ description: "", project: "", tags: "" });
  const [stopping, setStopping] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Fetch logs ─────────────────────────────────────────────
  const loadLogs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("time_logs")
      .select("*")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(30);
    if (error) {
      toast.error("Failed to load time logs");
    } else {
      setLogs((data as TimeLog[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);
  useEffect(() => { if (lastActionTs) loadLogs(); }, [lastActionTs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Timer interval ─────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (activeTimer) {
      intervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - activeTimer.startedAt.getTime()) / 1000);
        setTimerDisplay(formatHMS(elapsed));
      }, 1000);
    } else {
      setTimerDisplay("00:00:00");
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeTimer]);

  // ─── Start timer ────────────────────────────────────────────
  function startTimer() {
    if (!newForm.description.trim()) {
      toast.error("Enter a description before starting");
      return;
    }
    setActiveTimer({
      description: newForm.description.trim(),
      project: newForm.project.trim(),
      startedAt: new Date(),
    });
    toast.success("Timer started");
  }

  // ─── Stop timer ─────────────────────────────────────────────
  async function stopTimer() {
    if (!activeTimer || !user) return;
    setStopping(true);
    const endedAt = new Date();
    const tagsArray = newForm.tags
      ? newForm.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    const { error } = await supabase.from("time_logs").insert({
      user_id: user.id,
      description: activeTimer.description,
      project: activeTimer.project || null,
      started_at: activeTimer.startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: Math.round((endedAt.getTime() - activeTimer.startedAt.getTime()) / 1000),
      tags: tagsArray.length > 0 ? tagsArray : null,
    });

    if (error) {
      toast.error("Failed to save time log");
    } else {
      toast.success("Time logged");
      setActiveTimer(null);
      setNewForm({ description: "", project: "", tags: "" });
      await loadLogs();
    }
    setStopping(false);
  }

  // ─── Delete log ─────────────────────────────────────────────
  async function deleteLog(id: string) {
    setLogs((prev) => prev.filter((l) => l.id !== id));
    const { error } = await supabase.from("time_logs").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete log");
      loadLogs();
    } else {
      toast.success("Log deleted");
    }
  }

  // ─── Computed stats ─────────────────────────────────────────
  const today = todayStart();
  const week = weekStart();

  const todaySeconds = logs
    .filter((l) => new Date(l.started_at) >= today)
    .reduce((s, l) => s + (l.duration_seconds ?? 0), 0);

  const weekSeconds = logs
    .filter((l) => new Date(l.started_at) >= week)
    .reduce((s, l) => s + (l.duration_seconds ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Time Tracking"
        subtitle="Log and track time per task/project"
        icon={<Clock size={18} />}
      />

      {/* ── Active Timer / Start Form ────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeTimer ? (
          <motion.div
            key="active"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <HudCard glowColor="green" className="text-center">
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    Timer Running
                  </span>
                </div>
                <p className="font-display text-primary text-4xl font-bold tabular-nums tracking-widest">
                  {timerDisplay}
                </p>
                <div className="flex flex-col items-center gap-0.5">
                  <p className="text-sm font-mono text-foreground">{activeTimer.description}</p>
                  {activeTimer.project && (
                    <span className="text-xs font-mono px-2 py-0.5 rounded border border-border bg-muted/30 text-muted-foreground">
                      {activeTimer.project}
                    </span>
                  )}
                </div>
                <button
                  onClick={stopTimer}
                  disabled={stopping}
                  className="flex items-center gap-1.5 px-5 py-2 text-xs font-mono bg-red-900/30 border border-red-700/50 text-red-300 rounded hover:bg-red-900/50 disabled:opacity-50 transition-colors mt-1"
                >
                  {stopping ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Square size={12} />
                  )}
                  Stop & Save
                </button>
              </div>
            </HudCard>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <HudCard glowColor="gold">
              <p className="text-xs font-mono text-primary uppercase tracking-widest mb-3">
                Start New Timer
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-1">
                  <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                    Description *
                  </label>
                  <input
                    type="text"
                    value={newForm.description}
                    onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && startTimer()}
                    placeholder="What are you working on?"
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                    Project
                  </label>
                  <input
                    type="text"
                    value={newForm.project}
                    onChange={(e) => setNewForm((f) => ({ ...f, project: e.target.value }))}
                    placeholder="e.g. MAVIS"
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                    Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={newForm.tags}
                    onChange={(e) => setNewForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="dev, research"
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                  />
                </div>
              </div>
              <div className="flex justify-end mt-3">
                <button
                  onClick={startTimer}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-green-900/30 border border-green-700/50 text-green-300 rounded hover:bg-green-900/50 transition-colors"
                >
                  <Play size={11} /> Start Timer
                </button>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Summary Cards ────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="grid grid-cols-3 gap-3"
      >
        {[
          { label: "Today", value: formatDuration(todaySeconds), color: "text-primary" },
          { label: "This Week", value: formatDuration(weekSeconds), color: "text-cyan-400" },
          { label: "Total Entries", value: String(logs.length), color: "text-amber-400" },
        ].map((stat) => (
          <HudCard key={stat.label}>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
              {stat.label}
            </p>
            <p className={`text-xl font-display font-bold ${stat.color}`}>{stat.value}</p>
          </HudCard>
        ))}
      </motion.div>

      {/* ── Log List ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono text-primary uppercase tracking-widest">
            Recent Logs
          </h2>
          <span className="text-xs font-mono text-muted-foreground">
            Last {logs.length} entries
          </span>
        </div>
        <HudCard className="max-h-[480px] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-primary" size={18} />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10">
              <Clock size={28} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-xs font-mono text-muted-foreground">No time logged yet.</p>
              <p className="text-xs font-mono text-muted-foreground mt-0.5">
                Start a timer above to begin tracking.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-3 px-3 py-2 rounded bg-muted/20 border border-border/40 hover:bg-muted/30 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-mono text-foreground truncate">
                        {log.description}
                      </span>
                      {log.project && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded border border-border bg-muted/40 text-muted-foreground shrink-0">
                          {log.project}
                        </span>
                      )}
                      {log.tags && log.tags.length > 0 && log.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs font-mono px-1 py-0.5 rounded border border-primary/20 bg-primary/10 text-primary/70 shrink-0"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {fmtDate(log.started_at)}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-primary shrink-0">
                    {formatDuration(log.duration_seconds)}
                  </span>
                  <button
                    onClick={() => setConfirmDelete({ id: log.id, label: log.description })}
                    className="shrink-0 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </HudCard>
      </motion.div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          await deleteLog(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* ── Manual Add hint ──────────────────────────────────── */}
      {!loading && !activeTimer && (
        <div className="flex justify-center">
          <p className="text-xs font-mono text-muted-foreground">
            <Plus size={10} className="inline mr-1" />
            Use the form above to start tracking. Logs save automatically when you stop.
          </p>
        </div>
      )}
    </div>
  );
}
