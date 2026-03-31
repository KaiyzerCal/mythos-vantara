import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ScrollText, Zap, Shield, ShieldOff, Package, Star, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";

interface ActivityEntry {
  id: string;
  event_type: string;
  description: string;
  xp_amount: number;
  created_at: string;
}

const EVENT_CONFIG: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  xp_gain: { icon: Zap, color: "text-primary", label: "XP Gained" },
  buff: { icon: Shield, color: "text-secondary", label: "Buff Applied" },
  debuff: { icon: ShieldOff, color: "text-destructive", label: "Debuff" },
  loot: { icon: Package, color: "text-[hsl(var(--neon-cyan))]", label: "Loot Drop" },
  quest_complete: { icon: Star, color: "text-primary", label: "Quest Complete" },
  codex: { icon: ScrollText, color: "text-[hsl(var(--neon-purple))]", label: "Codex Points" },
  skill_up: { icon: Zap, color: "text-[hsl(var(--neon-green))]", label: "Skill Up" },
  stat_up: { icon: Zap, color: "text-[hsl(var(--neon-gold))]", label: "Stat Up" },
};

const FILTERS = ["all", "xp_gain", "buff", "debuff", "loot", "quest_complete", "codex", "skill_up", "stat_up"];

export default function ActivityLogPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const fetchEntries = useCallback(async () => {
    if (!user) return;
    let query = supabase
      .from("activity_log")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter !== "all") {
      query = query.eq("event_type", filter);
    }

    const { data } = await query;
    if (data) setEntries(data as ActivityEntry[]);
    setLoading(false);
  }, [user, filter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const grouped = entries.reduce<Record<string, ActivityEntry[]>>((acc, e) => {
    const day = new Date(e.created_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    (acc[day] ??= []).push(e);
    return acc;
  }, {});

  const getConfig = (type: string) => EVENT_CONFIG[type] || { icon: Zap, color: "text-muted-foreground", label: type };

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title="Activity Log" subtitle="Timeline of all events, rewards, and effects" icon={<ScrollText size={18} />} />

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-[10px] font-mono uppercase rounded border transition-all ${
              filter === f
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border text-muted-foreground hover:border-border/80"
            }`}
          >
            {f === "all" ? "All" : (EVENT_CONFIG[f]?.label || f)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs font-mono text-muted-foreground animate-pulse">Loading activity...</p>
      ) : entries.length === 0 ? (
        <HudCard>
          <p className="text-xs font-mono text-muted-foreground text-center py-8">No activity recorded yet. Complete quests to generate events.</p>
        </HudCard>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([day, items]) => (
            <div key={day}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">{day}</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="ml-1 border-l border-border/50 pl-4 space-y-1.5">
                {items.map((entry, i) => {
                  const cfg = getConfig(entry.event_type);
                  const Icon = cfg.icon;
                  const time = new Date(entry.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="flex items-start gap-3 py-1.5 group"
                    >
                      <div className={`mt-0.5 p-1 rounded border border-border/50 ${cfg.color}`}>
                        <Icon size={10} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-mono uppercase ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-[9px] font-mono text-muted-foreground">{time}</span>
                        </div>
                        <p className="text-xs text-foreground/80 truncate">{entry.description}</p>
                      </div>
                      {entry.xp_amount > 0 && (
                        <span className="text-[10px] font-mono text-primary whitespace-nowrap">+{entry.xp_amount} XP</span>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
