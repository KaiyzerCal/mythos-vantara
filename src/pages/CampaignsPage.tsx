import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/SharedUI";
import { Loader2, Play, Square, CheckCircle, XCircle, Clock, Zap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface Campaign {
  id: string;
  name: string;
  goal: string;
  status: string;
  current_step: number;
  total_steps: number | null;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    running:   { cls: "text-blue-400 border-blue-500/30 bg-blue-500/5",    icon: <Loader2 size={10} className="animate-spin" />, label: "Running" },
    pending:   { cls: "text-amber-400 border-amber-500/30 bg-amber-500/5", icon: <Clock size={10} />, label: "Pending" },
    complete:  { cls: "text-green-400 border-green-500/30 bg-green-500/5", icon: <CheckCircle size={10} />, label: "Complete" },
    completed: { cls: "text-green-400 border-green-500/30 bg-green-500/5", icon: <CheckCircle size={10} />, label: "Complete" },
    failed:    { cls: "text-red-400 border-red-500/30 bg-red-500/5",       icon: <XCircle size={10} />, label: "Failed" },
    cancelled: { cls: "text-muted-foreground border-border bg-muted/10",   icon: <Square size={10} />, label: "Cancelled" },
  };
  const s = styles[status] ?? styles.pending;
  return (
    <span className={`flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded border ${s.cls}`}>
      {s.icon} {s.label}
    </span>
  );
}

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "complete">("all");
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data, error } = await (supabase as any)
        .from("mavis_campaigns")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) console.warn("[Campaigns] load error:", error.message);
      else setCampaigns(data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stopCampaign = async (id: string) => {
    setStoppingId(id);
    try {
      await (supabase as any)
        .from("mavis_campaigns")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", id);
      setCampaigns((prev) => prev.map((c) => c.id === id ? { ...c, status: "cancelled" } : c));
      toast.success("Campaign stopped");
    } catch {
      toast.error("Failed to stop campaign");
    } finally {
      setStoppingId(null);
    }
  };

  const visible = campaigns.filter((c) => {
    if (filter === "active")   return c.status === "running" || c.status === "pending";
    if (filter === "complete") return c.status === "complete" || c.status === "completed" || c.status === "failed" || c.status === "cancelled";
    return true;
  });

  const activeCnt = campaigns.filter((c) => c.status === "running" || c.status === "pending").length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Campaigns"
        subtitle="Autonomous multi-step goals"
        icon={<Zap size={18} />}
        actions={
          <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
            <RefreshCw size={12} /> Refresh
          </button>
        }
      />

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border pb-0">
        {(["all", "active", "complete"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-xs font-mono border-b-2 capitalize transition-colors ${
              filter === f ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {f}
            {f === "active" && activeCnt > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs">
                {activeCnt}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-primary/50" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-xs font-mono text-muted-foreground">No campaigns found.</p>
          <p className="text-[10px] font-mono text-muted-foreground mt-1">
            Tell MAVIS "create a campaign to [goal]" to launch one.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence>
            {visible.map((c) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                layout
                className="border border-border rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-mono font-medium truncate">{c.name}</p>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">{c.goal}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {c.total_steps != null && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          Step {c.current_step}/{c.total_steps}
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(c.created_at)}</span>
                    </div>
                    {c.total_steps != null && (
                      <div className="mt-1.5 h-0.5 bg-muted rounded-full overflow-hidden max-w-[200px]">
                        <div
                          className={`h-full rounded-full transition-all ${
                            c.status === "complete" || c.status === "completed" ? "bg-green-400" :
                            c.status === "failed" ? "bg-red-400" : "bg-primary"
                          }`}
                          style={{ width: `${Math.round((c.current_step / c.total_steps) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {(c.status === "running" || c.status === "pending") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); stopCampaign(c.id); }}
                      disabled={stoppingId === c.id}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 text-xs font-mono disabled:opacity-40 transition-colors"
                    >
                      {stoppingId === c.id ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}
                      Stop
                    </button>
                  )}
                </button>

                <AnimatePresence>
                  {expandedId === c.id && (
                    <motion.div
                      initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                      className="overflow-hidden border-t border-border"
                    >
                      <div className="px-4 py-3 space-y-2">
                        <div>
                          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Goal</p>
                          <p className="text-xs font-mono text-foreground/80">{c.goal}</p>
                        </div>
                        {c.result && (
                          <div>
                            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Result</p>
                            <p className="text-xs font-mono text-green-300/80 whitespace-pre-wrap">{c.result.slice(0, 500)}</p>
                          </div>
                        )}
                        {c.error && (
                          <div>
                            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Error</p>
                            <p className="text-xs font-mono text-red-400/80">{c.error.slice(0, 300)}</p>
                          </div>
                        )}
                        <p className="text-[10px] font-mono text-muted-foreground">
                          Created {new Date(c.created_at).toLocaleString()}
                          {c.completed_at && ` · Completed ${new Date(c.completed_at).toLocaleString()}`}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
