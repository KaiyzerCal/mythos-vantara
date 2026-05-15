import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/SharedUI";
import { Inbox as InboxIcon, Eye, CheckCircle, Clock, AlertCircle, BookOpen, ListTodo, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface Approval {
  id: string;
  action_type: string;
  action_summary: string;
  action_payload: Record<string, unknown>;
  status: string;
  created_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  user_id: string;
  workspace_id: string | null;
}

interface WatchtowerBrief {
  id: string;
  brief_date: string;
  summary: string;
  content: string;
  read: boolean;
  created_at: string;
  user_id: string;
}

interface MavisTask {
  id: string;
  type: string;
  description: string | null;
  payload: Record<string, unknown>;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown> | null;
  revenue_generated: number;
  created_at: string;
}

type InboxTab = "approvals" | "briefs" | "tasks";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    approved: "text-green-400 border-green-500/30 bg-green-500/5",
    rejected: "text-red-400 border-red-500/30 bg-red-500/5",
    expired: "text-muted-foreground border-border bg-muted/20",
  };
  return map[status] ?? "text-muted-foreground border-border";
}

function taskStatusStyle(status: string) {
  const map: Record<string, { icon: React.ReactNode; color: string; badge: string }> = {
    pending:                { icon: <Clock size={12} />, color: "text-amber-400", badge: "text-amber-400 border-amber-500/30 bg-amber-500/5" },
    running:                { icon: <Loader2 size={12} className="animate-spin" />, color: "text-blue-400", badge: "text-blue-400 border-blue-500/30 bg-blue-500/5" },
    completed:              { icon: <CheckCircle size={12} />, color: "text-green-400", badge: "text-green-400 border-green-500/30 bg-green-500/5" },
    failed:                 { icon: <XCircle size={12} />, color: "text-red-400", badge: "text-red-400 border-red-500/30 bg-red-500/5" },
    cancelled:              { icon: <XCircle size={12} />, color: "text-muted-foreground", badge: "text-muted-foreground border-border bg-muted/10" },
    requires_confirmation:  { icon: <AlertCircle size={12} />, color: "text-orange-400", badge: "text-orange-400 border-orange-500/30 bg-orange-500/5" },
  };
  return map[status] ?? map.pending;
}

export default function Inbox() {
  const [tab, setTab] = useState<InboxTab>("approvals");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [briefs, setBriefs] = useState<WatchtowerBrief[]>([]);
  const [tasks, setTasks] = useState<MavisTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  type TaskFilter = "active" | "completed" | "failed" | "all";
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("active");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const uid = session.user.id;

      const [approvalsRes, briefsRes, tasksRes] = await Promise.all([
        supabase
          .from("approvals")
          .select("*")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("watchtower_briefs")
          .select("*")
          .eq("user_id", uid)
          .order("brief_date", { ascending: false })
          .limit(50),
        supabase
          .from("mavis_tasks")
          .select("*")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      if (approvalsRes.error) console.warn("[Inbox] approvals:", approvalsRes.error.message);
      else setApprovals((approvalsRes.data ?? []) as Approval[]);

      if (briefsRes.error) console.warn("[Inbox] briefs:", briefsRes.error.message);
      else setBriefs((briefsRes.data ?? []) as WatchtowerBrief[]);

      if (tasksRes.error) console.warn("[Inbox] tasks:", tasksRes.error.message);
      else setTasks((tasksRes.data ?? []) as MavisTask[]);
    } catch (err) {
      console.error("[Inbox] load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markBriefRead = async (id: string) => {
    setBriefs(prev => prev.map(b => b.id === id ? { ...b, read: true } : b));
    await supabase.from("watchtower_briefs").update({ read: true }).eq("id", id);
  };

  const approveTask = async (id: string) => {
    try {
      await supabase.from("mavis_tasks").update({ status: "pending" }).eq("id", id);
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: "pending" } : t));
      toast.success("Task approved — executor will run it next cycle");
    } catch {
      toast.error("Failed to approve task");
    }
  };

  const retryTask = async (id: string) => {
    setRetryingId(id);
    try {
      await supabase.from("mavis_tasks").update({ status: "pending", result: null }).eq("id", id);
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: "pending", result: null } : t));
      toast.success("Task re-queued — executor will retry it next cycle");
    } catch {
      toast.error("Failed to retry task");
    } finally {
      setRetryingId(null);
    }
  };

  const cancelTask = async (id: string) => {
    setCancellingId(id);
    try {
      await supabase.from("mavis_tasks").update({ status: "cancelled" }).eq("id", id);
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: "cancelled" } : t));
      toast.success("Task cancelled");
    } catch {
      toast.error("Failed to cancel task");
    } finally {
      setCancellingId(null);
    }
  };

  const runTaskNow = async (id: string) => {
    try {
      toast.message("Triggering task executor…");
      const { error } = await supabase.functions.invoke("mavis-task-executor");
      if (error) throw error;
      toast.success("Executor fired — refresh to see results");
      setTimeout(load, 3000);
    } catch (err) {
      toast.error(`Executor error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const [executingId, setExecutingId] = useState<string | null>(null);

  const cosignWithMavis = async (a: Approval): Promise<{ ok: boolean; reason: string }> => {
    try {
      const { data, error } = await supabase.functions.invoke("mavis-chat", {
        body: {
          mode: "PRIME",
          messages: [
            {
              role: "user",
              content:
                `MAVIS CO-SIGN REVIEW. The operator has approved a proposed write to the app. ` +
                `Verify it's safe, coherent with the operator's state, and not destructive without cause. ` +
                `Respond with exactly one line: "COSIGN: YES — <short reason>" or "COSIGN: NO — <short reason>".\n\n` +
                `Action type: ${a.action_type}\n` +
                `Summary: ${a.action_summary}\n` +
                `Payload: ${JSON.stringify(a.action_payload)}`,
            },
          ],
          skipPersist: true,
          skipActions: true,
        },
      });
      if (error) return { ok: true, reason: "co-sign skipped (chat error)" };
      const reply = String(data?.reply ?? data?.content ?? "").trim();
      const yes = /COSIGN:\s*YES/i.test(reply);
      const no = /COSIGN:\s*NO/i.test(reply);
      if (no) return { ok: false, reason: reply.slice(0, 200) };
      if (yes) return { ok: true, reason: reply.slice(0, 200) };
      return { ok: true, reason: "co-sign neutral" };
    } catch (err) {
      return { ok: true, reason: `co-sign skipped (${err instanceof Error ? err.message : "error"})` };
    }
  };

  const resolveApproval = async (id: string, decision: "approved" | "rejected") => {
    const target = approvals.find(x => x.id === id);
    if (!target) return;

    if (decision === "rejected") {
      try {
        await supabase
          .from("approvals")
          .update({ status: "rejected", resolved_at: new Date().toISOString() })
          .eq("id", id);
        setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: "rejected", resolved_at: new Date().toISOString() } : a));
        toast.success("Action rejected");
      } catch {
        toast.error("Failed to update approval");
      }
      return;
    }

    setExecutingId(id);
    try {
      // 1) MAVIS co-sign review
      toast.message("MAVIS reviewing proposal…");
      const verdict = await cosignWithMavis(target);
      if (!verdict.ok) {
        toast.error(`MAVIS withheld co-sign: ${verdict.reason}`);
        setExecutingId(null);
        return;
      }

      // 2) Execute via mavis-actions
      const payload = (target.action_payload ?? {}) as { type?: string; params?: Record<string, unknown> };
      const action = {
        type: String(payload.type ?? target.action_type),
        params: (payload.params && typeof payload.params === "object") ? payload.params : {},
      };
      const { data: execData, error: execErr } = await supabase.functions.invoke("mavis-actions", {
        body: { actions: [action] },
      });
      if (execErr) throw execErr;
      const result = Array.isArray(execData?.results) ? execData.results[0] : null;
      if (result && result.success === false) throw new Error(result.error || "Execution failed");

      // 3) Mark approved
      await supabase
        .from("approvals")
        .update({ status: "approved", resolved_at: new Date().toISOString() })
        .eq("id", id);
      setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: "approved", resolved_at: new Date().toISOString() } : a));
      toast.success(`Approved & executed (${action.type})`);
    } catch (err) {
      toast.error(`Execution failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setExecutingId(null);
    }
  };

  const unreadBriefs = briefs.filter(b => !b.read).length;
  const pendingApprovals = approvals.filter(a => a.status === "pending").length;
  const activeTasks = tasks.filter(t => t.status === "pending" || t.status === "running" || t.status === "requires_confirmation").length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Inbox"
        subtitle="Approvals & Intelligence Briefs"
        icon={<InboxIcon size={18} />}
        actions={
          <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors">
            Refresh
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-0">
        <button
          onClick={() => setTab("approvals")}
          className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors ${tab === "approvals" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Approvals
          {pendingApprovals > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[9px]">
              {pendingApprovals}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("briefs")}
          className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors ${tab === "briefs" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Watchtower Briefs
          {unreadBriefs > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 text-[9px]">
              {unreadBriefs}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("tasks")}
          className={`px-4 py-2 text-xs font-mono border-b-2 transition-colors ${tab === "tasks" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Task Log
          {activeTasks > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[9px]">
              {activeTasks}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {tab === "approvals" && (
            <motion.div key="approvals" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
              {approvals.length === 0 && (
                <p className="text-xs font-mono text-muted-foreground text-center py-12">No approvals in queue.</p>
              )}
              {approvals.map(a => (
                <motion.div
                  key={a.id}
                  layout
                  className="border border-border rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
                  >
                    <AlertCircle size={14} className="text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono font-medium truncate">{a.action_summary}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{a.action_type} · {timeAgo(a.created_at)}</p>
                    </div>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${statusBadge(a.status)}`}>
                      {a.status}
                    </span>
                  </button>

                  <AnimatePresence>
                    {expandedId === a.id && (
                      <motion.div
                        initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                        className="overflow-hidden border-t border-border"
                      >
                        <div className="px-4 py-3 space-y-3">
                          <pre className="text-[10px] font-mono text-muted-foreground bg-muted/10 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(a.action_payload, null, 2)}
                          </pre>
                          {a.expires_at && (
                            <p className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                              <Clock size={10} /> Expires {timeAgo(a.expires_at)}
                            </p>
                          )}
                          {a.status === "pending" && (
                            <div className="flex gap-2 items-center">
                              <button
                                disabled={executingId === a.id}
                                onClick={() => resolveApproval(a.id, "approved")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                              >
                                <CheckCircle size={10} /> {executingId === a.id ? "MAVIS reviewing…" : "Approve & Execute"}
                              </button>
                              <button
                                disabled={executingId === a.id}
                                onClick={() => resolveApproval(a.id, "rejected")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                              >
                                Reject
                              </button>
                              <span className="text-[9px] font-mono text-muted-foreground ml-auto">requires MAVIS co-sign</span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </motion.div>
          )}

          {tab === "briefs" && (
            <motion.div key="briefs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
              {briefs.length === 0 && (
                <p className="text-xs font-mono text-muted-foreground text-center py-12">No watchtower briefs.</p>
              )}
              {briefs.map(b => (
                <motion.div
                  key={b.id}
                  layout
                  className={`border rounded-lg overflow-hidden transition-colors ${b.read ? "border-border" : "border-cyan-500/30"}`}
                >
                  <button
                    onClick={() => {
                      setExpandedId(expandedId === b.id ? null : b.id);
                      if (!b.read) markBriefRead(b.id);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
                  >
                    <BookOpen size={14} className={b.read ? "text-muted-foreground" : "text-cyan-400"} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-mono font-medium truncate ${b.read ? "text-muted-foreground" : "text-foreground"}`}>
                        {b.summary}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground">{b.brief_date} · {timeAgo(b.created_at)}</p>
                    </div>
                    {!b.read && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />}
                    <Eye size={12} className="text-muted-foreground shrink-0" />
                  </button>

                  <AnimatePresence>
                    {expandedId === b.id && (
                      <motion.div
                        initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                        className="overflow-hidden border-t border-border"
                      >
                        <div className="px-4 py-3">
                          <p className="text-xs font-body text-foreground/90 leading-relaxed whitespace-pre-wrap">{b.content}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </motion.div>
          )}
          {tab === "tasks" && (
            <motion.div key="tasks" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
              {/* Filter bar */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  {(["active", "completed", "failed", "all"] as const).map(f => {
                    const counts: Record<string, number> = {
                      active:    tasks.filter(t => ["pending","running","requires_confirmation"].includes(t.status)).length,
                      completed: tasks.filter(t => t.status === "completed").length,
                      failed:    tasks.filter(t => t.status === "failed").length,
                      all:       tasks.length,
                    };
                    return (
                      <button
                        key={f}
                        onClick={() => setTaskFilter(f)}
                        className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
                          taskFilter === f
                            ? "border-primary/50 text-primary bg-primary/10"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                        <span className="ml-1 opacity-60">{counts[f]}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => runTaskNow("")}
                  className="text-[10px] font-mono text-primary hover:text-primary/80 transition-colors border border-primary/30 px-2 py-1 rounded"
                >
                  Run Executor Now
                </button>
              </div>

              {(() => {
                const filtered = tasks.filter(t => {
                  if (taskFilter === "active")    return ["pending","running","requires_confirmation"].includes(t.status);
                  if (taskFilter === "completed") return t.status === "completed";
                  if (taskFilter === "failed")    return t.status === "failed";
                  return true;
                });
                if (filtered.length === 0) return (
                  <p className="text-xs font-mono text-muted-foreground text-center py-12">
                    No {taskFilter === "all" ? "" : taskFilter} tasks.
                  </p>
                );
                return <>{filtered.map(t => {
                const style = taskStatusStyle(t.status);
                return (
                  <motion.div key={t.id} layout className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
                    >
                      <span className={style.color}>{style.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono font-medium truncate">
                          {t.description ?? t.type}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {t.type} · {timeAgo(t.created_at)}
                          {t.revenue_generated > 0 && (
                            <span className="ml-2 text-green-400">+${Number(t.revenue_generated).toFixed(2)}</span>
                          )}
                        </p>
                      </div>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${style.badge}`}>
                        {t.status.replace("_", " ")}
                      </span>
                    </button>

                    <AnimatePresence>
                      {expandedId === t.id && (
                        <motion.div
                          initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                          className="overflow-hidden border-t border-border"
                        >
                          <div className="px-4 py-3 space-y-2">
                            {Object.keys(t.payload ?? {}).length > 0 && (
                              <div>
                                <p className="text-[9px] font-mono text-muted-foreground mb-1">PAYLOAD</p>
                                <pre className="text-[10px] font-mono text-muted-foreground bg-muted/10 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                                  {JSON.stringify(t.payload, null, 2)}
                                </pre>
                              </div>
                            )}
                            {t.result && Object.keys(t.result).length > 0 && (
                              <div>
                                <p className="text-[9px] font-mono text-muted-foreground mb-1">RESULT</p>
                                <pre className="text-[10px] font-mono text-muted-foreground bg-muted/10 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                                  {JSON.stringify(t.result, null, 2)}
                                </pre>
                              </div>
                            )}
                            <div className="flex gap-2 items-center text-[9px] font-mono text-muted-foreground">
                              {t.started_at && <span>Started {timeAgo(t.started_at)}</span>}
                              {t.completed_at && <span>· Completed {timeAgo(t.completed_at)}</span>}
                              {t.scheduled_at && <span>· Scheduled {timeAgo(t.scheduled_at)}</span>}
                            </div>
                            {(t.status === "pending" || t.status === "requires_confirmation") && (
                              <div className="flex gap-2">
                                {t.status === "requires_confirmation" && (
                                  <button
                                    onClick={() => approveTask(t.id)}
                                    className="text-[10px] font-mono text-green-400 hover:text-green-300 border border-green-500/20 px-2 py-1 rounded transition-colors"
                                  >
                                    Approve & Queue
                                  </button>
                                )}
                                <button
                                  disabled={cancellingId === t.id}
                                  onClick={() => cancelTask(t.id)}
                                  className="text-[10px] font-mono text-red-400 hover:text-red-300 border border-red-500/20 px-2 py-1 rounded transition-colors disabled:opacity-40"
                                >
                                  {cancellingId === t.id ? "Cancelling…" : "Cancel"}
                                </button>
                              </div>
                            )}
                            {t.status === "failed" && (
                              <div className="flex gap-2">
                                <button
                                  disabled={retryingId === t.id}
                                  onClick={() => retryTask(t.id)}
                                  className="text-[10px] font-mono text-amber-400 hover:text-amber-300 border border-amber-500/20 px-2 py-1 rounded transition-colors disabled:opacity-40"
                                >
                                  {retryingId === t.id ? "Re-queuing…" : "Retry"}
                                </button>
                                <button
                                  disabled={cancellingId === t.id}
                                  onClick={() => cancelTask(t.id)}
                                  className="text-[10px] font-mono text-red-400 hover:text-red-300 border border-red-500/20 px-2 py-1 rounded transition-colors disabled:opacity-40"
                                >
                                  {cancellingId === t.id ? "Cancelling…" : "Dismiss"}
                                </button>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );})}
                </>;
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
