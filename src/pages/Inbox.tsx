import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/SharedUI";
import { Inbox as InboxIcon, Eye, CheckCircle, Clock, AlertCircle, BookOpen } from "lucide-react";
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

type InboxTab = "approvals" | "briefs";

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

export default function Inbox() {
  const [tab, setTab] = useState<InboxTab>("approvals");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [briefs, setBriefs] = useState<WatchtowerBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const uid = session.user.id;

      const [approvalsRes, briefsRes] = await Promise.all([
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
      ]);

      if (approvalsRes.error) console.warn("[Inbox] approvals:", approvalsRes.error.message);
      else setApprovals((approvalsRes.data ?? []) as Approval[]);

      if (briefsRes.error) console.warn("[Inbox] briefs:", briefsRes.error.message);
      else setBriefs((briefsRes.data ?? []) as WatchtowerBrief[]);
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
                            <div className="flex gap-2">
                              <button
                                onClick={() => resolveApproval(a.id, "approved")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 transition-colors"
                              >
                                <CheckCircle size={10} /> Approve
                              </button>
                              <button
                                onClick={() => resolveApproval(a.id, "rejected")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
                              >
                                Reject
                              </button>
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
        </AnimatePresence>
      )}
    </div>
  );
}
