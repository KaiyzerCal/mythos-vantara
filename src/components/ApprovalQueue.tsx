import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Check, X, AlertTriangle, Inbox, Clock } from "lucide-react";
import { toast } from "sonner";

interface PendingAction {
  id: string;
  action_type: string;
  action_payload: Record<string, any>;
  source_context: string;
  priority: number;
  created_at: string;
  expires_at: string | null;
}

const ACTION_DESCRIPTIONS: Record<string, (p: Record<string, any>) => string> = {
  send_message: (p) => `Send message to ${p.contact_name ?? p.to ?? "contact"}`,
  make_call:    (p) => `Call ${p.contact_name ?? p.phone ?? "contact"}`,
  draft_email:  (p) => `Draft email: "${(p.subject ?? "").slice(0, 50)}"`,
  web_post:     (p) => `Post to ${p.platform ?? "social"}`,
  schedule_event:(p) => `Schedule "${(p.title ?? "event").slice(0, 40)}"`,
  update_quest: (p) => `Update quest: "${(p.title ?? "").slice(0, 40)}"`,
  nora_tweet:   (p) => `Tweet as Nora: "${(p.content ?? "").slice(0, 60)}..."`,
};

function describe(action: PendingAction) {
  const fn = ACTION_DESCRIPTIONS[action.action_type];
  if (fn) return fn(action.action_payload ?? {});
  return action.source_context ?? action.action_type;
}

function priorityLabel(p: number) {
  if (p <= 2) return { label: "Critical", cls: "text-red-400 border-red-500/30 bg-red-900/20" };
  if (p <= 4) return { label: "High", cls: "text-amber-400 border-amber-500/30 bg-amber-900/20" };
  return { label: "Normal", cls: "text-muted-foreground border-border bg-muted/30" };
}

export function ApprovalQueue({ userId, onCountChange }: { userId: string; onCountChange?: (n: number) => void }) {
  const [items, setItems] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("mavis_action_queue")
      .select("id,action_type,action_payload,source_context,priority,created_at,expires_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .eq("autonomy_tier", "approve")
      .order("priority", { ascending: true })
      .limit(10);
    const valid = (data ?? []).filter((a: PendingAction) =>
      !a.expires_at || new Date(a.expires_at) > new Date()
    );
    setItems(valid);
    onCountChange?.(valid.length);
    setLoading(false);
  }, [userId, onCountChange]);

  useEffect(() => {
    load();
    const channel = (supabase as any)
      .channel(`approval-queue-${userId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "mavis_action_queue",
        filter: `user_id=eq.${userId}`,
      }, () => load())
      .subscribe();
    return () => { (supabase as any).removeChannel(channel); };
  }, [load, userId]);

  async function decide(id: string, decision: "approved" | "rejected") {
    setActing(id);
    const { error } = await (supabase as any)
      .from("mavis_action_queue")
      .update({ status: decision, approved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { toast.error("Failed to update action"); }
    else {
      toast.success(decision === "approved" ? "Approved — MAVIS will execute" : "Rejected");
      setItems(prev => prev.filter(i => i.id !== id));
      onCountChange?.(items.length - 1);
    }
    setActing(null);
  }

  if (loading) return (
    <div className="space-y-2 py-2">
      {[...Array(2)].map((_, i) => (
        <div key={i} className="hud-border rounded-lg p-3 space-y-2 animate-pulse">
          <div className="h-3 bg-muted rounded w-3/4" />
          <div className="h-2.5 bg-muted rounded w-1/2" />
        </div>
      ))}
    </div>
  );

  if (!items.length) return (
    <div className="py-8 text-center">
      <Inbox size={20} className="text-muted-foreground mx-auto mb-2" />
      <p className="text-xs font-mono text-muted-foreground">No pending approvals.</p>
    </div>
  );

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {items.map(item => {
          const pri = priorityLabel(item.priority);
          const isExpiringSoon = item.expires_at && new Date(item.expires_at).getTime() - Date.now() < 6 * 3600 * 1000;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
              className="hud-border rounded-lg p-3 space-y-2"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-foreground leading-snug">{describe(item)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.source_context}</p>
                </div>
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded border shrink-0 ${pri.cls}`}>
                  {pri.label}
                </span>
              </div>
              {isExpiringSoon && (
                <div className="flex items-center gap-1 text-xs text-amber-400 font-mono">
                  <Clock size={10} /> Expires soon
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => decide(item.id, "approved")}
                  disabled={acting === item.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1 text-xs font-mono bg-green-900/20 border border-green-700/40 text-green-400 rounded hover:bg-green-900/40 transition-all disabled:opacity-50 active:scale-[0.97]"
                >
                  <Check size={11} /> Approve
                </button>
                <button
                  onClick={() => decide(item.id, "rejected")}
                  disabled={acting === item.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1 text-xs font-mono bg-red-900/20 border border-red-700/40 text-red-400 rounded hover:bg-red-900/40 transition-all disabled:opacity-50 active:scale-[0.97]"
                >
                  <X size={11} /> Reject
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
