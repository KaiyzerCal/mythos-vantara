import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Cpu, CheckCircle2, Zap, Radio, ExternalLink } from "lucide-react";

interface FeedItem {
  id: string;
  label: string;
  detail: string;
  source: string;
  ts: string;
  kind: "executed" | "completed" | "auto";
}

const ACTION_LABELS: Record<string, string> = {
  create_task: "Created task",
  send_notification: "Sent notification",
  update_quest: "Updated quest",
  create_note: "Created note",
  draft_email: "Drafted email",
  schedule_event: "Scheduled event",
  send_message: "Sent message",
  nora_tweet: "Posted as Nora Vale",
  create_product: "Created product",
  send_announcement: "Sent announcement",
  demand_scan: "Scanned market demand",
  goal: "Decomposed goal",
  revenue_snapshot: "Logged revenue",
  memory_consolidation: "Consolidated memory",
  check_idle_quests: "Checked idle quests",
};

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MavisActivityFeed({ userId }: { userId: string }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

      const [{ data: actions }, { data: tasks }] = await Promise.all([
        (supabase as any)
          .from("mavis_action_queue")
          .select("id,action_type,source_context,source_system,status,executed_at,created_at")
          .eq("user_id", userId)
          .in("status", ["executed", "auto"])
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(15),
        (supabase as any)
          .from("mavis_tasks")
          .select("id,type,description,status,completed_at,created_at")
          .eq("user_id", userId)
          .eq("status", "completed")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      const feed: FeedItem[] = [
        ...(actions ?? []).map((a: any) => ({
          id: a.id,
          label: ACTION_LABELS[a.action_type] ?? a.action_type,
          detail: a.source_context ?? a.source_system ?? "autonomous",
          source: a.source_system ?? "MAVIS",
          ts: a.executed_at ?? a.created_at,
          kind: "executed" as const,
        })),
        ...(tasks ?? []).map((t: any) => ({
          id: t.id,
          label: ACTION_LABELS[t.type] ?? t.type,
          detail: t.description ?? "",
          source: "Task Executor",
          ts: t.completed_at ?? t.created_at,
          kind: "completed" as const,
        })),
      ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 20);

      setItems(feed);
      setLoading(false);
    }
    load();

    // Real-time subscription — prepend new executed actions
    const channel = (supabase as any)
      .channel(`mavis-feed-${userId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "mavis_action_queue",
        filter: `user_id=eq.${userId}`,
      }, (payload: any) => {
        const a = payload.new;
        if (!["executed", "auto"].includes(a.status)) return;
        const item: FeedItem = {
          id: a.id,
          label: ACTION_LABELS[a.action_type] ?? a.action_type,
          detail: a.source_context ?? a.source_system ?? "autonomous",
          source: a.source_system ?? "MAVIS",
          ts: a.executed_at ?? a.created_at,
          kind: "executed",
        };
        setItems(prev => [item, ...prev.filter(x => x.id !== a.id)].slice(0, 20));
      })
      .subscribe();

    return () => { (supabase as any).removeChannel(channel); };
  }, [userId]);

  if (loading) return (
    <div className="space-y-2 py-2">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex gap-3 items-start">
          <div className="w-5 h-5 rounded-full bg-muted animate-pulse shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="h-3 bg-muted animate-pulse rounded w-2/3" />
            <div className="h-2.5 bg-muted animate-pulse rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );

  if (!items.length) return (
    <div className="py-8 text-center">
      <Radio size={20} className="text-muted-foreground mx-auto mb-2" />
      <p className="text-xs font-mono text-muted-foreground">No autonomous actions in the last 48h.</p>
      <p className="text-xs text-muted-foreground mt-1">MAVIS will appear here when it acts.</p>
    </div>
  );

  return (
    <div className="space-y-0">
      <AnimatePresence initial={false}>
        {items.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.2, delay: i * 0.02 }}
            className="flex gap-3 items-start py-2 border-b border-border/40 last:border-0 group"
          >
            <div className="mt-0.5 shrink-0">
              {item.kind === "completed"
                ? <CheckCircle2 size={13} className="text-green-400" />
                : item.kind === "auto"
                ? <Zap size={13} className="text-amber-400" />
                : <Cpu size={13} className="text-primary" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-foreground leading-tight">{item.label}</p>
              {item.detail && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{item.detail}</p>
              )}
            </div>
            <span className="text-xs font-mono text-muted-foreground shrink-0 mt-0.5">{timeAgo(item.ts)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
