// ============================================================
// VANTARA.EXE — NotificationsPage
// Unified alert, insight, and approval hub
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, CheckCircle2, Eye, Trash2, Loader2, RefreshCw, AlertTriangle, Info, Zap, Activity, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

interface MavisInsight {
  id: string;
  title: string;
  content: string;
  category: string;
  severity: "info" | "warning" | "critical";
  source: string;
  read_at: string | null;
  generated_at: string;
}

interface ActivityEntry {
  id: string;
  event_type: string;
  description: string;
  xp_awarded: number | null;
  created_at: string;
}

interface InferredCommitment {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  info: <Info size={13} className="text-cyan-400" />,
  warning: <AlertTriangle size={13} className="text-amber-400" />,
  critical: <Zap size={13} className="text-red-400" />,
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "border-cyan-800/50 bg-cyan-950/20",
  warning: "border-amber-800/50 bg-amber-950/20",
  critical: "border-red-800/50 bg-red-950/20",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationsPage() {
  const { session } = useAuth();

  const [insights, setInsights] = useState<MavisInsight[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [commitments, setCommitments] = useState<InferredCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("unread");

  const load = useCallback(async () => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    const [insightsRes, activityRes, commitmentsRes] = await Promise.all([
      (supabase as any)
        .from("mavis_insights")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(50),
      (supabase as any)
        .from("mavis_activity_log")
        .select("id, event_type, description, xp_awarded, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      (supabase as any)
        .from("mavis_tasks")
        .select("id, title, description, status, created_at")
        .eq("source_skill", "inferred_commitment")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    setInsights((insightsRes.data as MavisInsight[]) ?? []);
    setActivity((activityRes.data as ActivityEntry[]) ?? []);
    setCommitments((commitmentsRes.data as InferredCommitment[]) ?? []);
    setLoading(false);
  }, [session]);

  useEffect(() => { load(); }, [load]);

  async function markRead(id: string) {
    const { error } = await (supabase as any)
      .from("mavis_insights")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error("Failed to mark as read"); return; }
    setInsights((prev) =>
      prev.map((ins) => (ins.id === id ? { ...ins, read_at: new Date().toISOString() } : ins))
    );
  }

  async function markAllRead() {
    const unreadIds = insights.filter((i) => !i.read_at).map((i) => i.id);
    if (unreadIds.length === 0) return;
    await (supabase as any)
      .from("mavis_insights")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadIds);
    setInsights((prev) => prev.map((ins) => ({ ...ins, read_at: ins.read_at ?? new Date().toISOString() })));
    toast.success("All notifications marked as read");
  }

  async function deleteInsight(id: string) {
    await (supabase as any).from("mavis_insights").delete().eq("id", id);
    setInsights((prev) => prev.filter((ins) => ins.id !== id));
  }

  async function markCommitmentDone(id: string) {
    const { error } = await (supabase as any)
      .from("mavis_tasks")
      .update({ status: "completed" })
      .eq("id", id);
    if (error) { toast.error("Failed to update commitment"); return; }
    setCommitments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "completed" } : c))
    );
  }

  const displayed = filter === "unread" ? insights.filter((i) => !i.read_at) : insights;
  const unreadCount = insights.filter((i) => !i.read_at).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="MAVIS alerts, insights, and system events"
        icon={<Bell size={18} />}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono bg-muted/30 border border-border text-muted-foreground rounded hover:text-primary hover:border-primary/30 transition-colors"
            >
              <RefreshCw size={10} /> Refresh
            </button>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
              >
                <CheckCircle2 size={10} /> Mark all read
              </button>
            )}
          </div>
        }
      />

      {/* Filter tabs */}
      <div className="flex items-center gap-1">
        {(["unread", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-[10px] font-mono rounded border transition-colors ${
              filter === f
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "unread" ? `Unread (${unreadCount})` : `All (${insights.length})`}
          </button>
        ))}
      </div>

      {/* Insights */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">MAVIS Insights</h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-primary" size={20} />
          </div>
        ) : displayed.length === 0 ? (
          <HudCard>
            <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
              <CheckCircle2 size={20} className="text-green-500/50" />
              <p className="text-xs font-mono">
                {filter === "unread" ? "All caught up — no unread notifications" : "No notifications yet"}
              </p>
            </div>
          </HudCard>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {displayed.map((ins, i) => (
                <motion.div
                  key={ins.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 6 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <HudCard
                    className={`border transition-opacity ${SEVERITY_STYLES[ins.severity] ?? SEVERITY_STYLES.info} ${ins.read_at ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">{SEVERITY_ICON[ins.severity] ?? SEVERITY_ICON.info}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-[9px] font-mono text-muted-foreground uppercase">{ins.category}</span>
                          <span className="text-[9px] font-mono text-muted-foreground ml-auto">{timeAgo(ins.generated_at)}</span>
                        </div>
                        <p className="text-sm font-display font-bold mb-0.5">{ins.title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{ins.content}</p>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {!ins.read_at && (
                          <button
                            onClick={() => markRead(ins.id)}
                            className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
                            title="Mark read"
                          >
                            <Eye size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteInsight(ins.id)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                          title="Dismiss"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </HudCard>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* MAVIS Detections */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">MAVIS Detections</h2>
        {loading ? null : commitments.length === 0 ? (
          <HudCard>
            <p className="text-xs font-mono text-muted-foreground text-center py-4">No inferred commitments detected yet.</p>
          </HudCard>
        ) : (
          <HudCard>
            <div className="space-y-2">
              {commitments.map((c, i) => {
                const displayTitle = c.title.startsWith("Commitment: ")
                  ? c.title.slice("Commitment: ".length)
                  : c.title;
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="flex items-center gap-3"
                  >
                    <Lightbulb size={12} className="text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono truncate">{displayTitle}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                          c.status === "completed"
                            ? "text-green-400 border-green-800 bg-green-950/40"
                            : "text-amber-400 border-amber-800 bg-amber-950/40"
                        }`}
                      >
                        {c.status}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground">{timeAgo(c.created_at)}</span>
                      {c.status !== "completed" && (
                        <button
                          onClick={() => markCommitmentDone(c.id)}
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                        >
                          Mark Done
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </HudCard>
        )}
      </section>

      {/* Recent Activity */}
      <section>
        <h2 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Recent Activity</h2>
        {loading ? null : activity.length === 0 ? (
          <HudCard>
            <p className="text-xs font-mono text-muted-foreground text-center py-4">No recent activity.</p>
          </HudCard>
        ) : (
          <HudCard>
            <div className="space-y-2">
              {activity.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="flex items-center gap-3"
                >
                  <Activity size={12} className="text-primary/50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono truncate">{a.description}</p>
                    <p className="text-[9px] font-mono text-muted-foreground">{a.event_type}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.xp_awarded && a.xp_awarded > 0 && (
                      <span className="text-[9px] font-mono text-amber-400">+{a.xp_awarded} XP</span>
                    )}
                    <span className="text-[9px] font-mono text-muted-foreground">{timeAgo(a.created_at)}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </HudCard>
        )}
      </section>
    </div>
  );
}
