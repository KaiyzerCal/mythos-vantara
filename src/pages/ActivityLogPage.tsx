import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ScrollText, Zap, Shield, ShieldOff, Package, Star, Filter, Target, BookOpen, Archive, Users, Layers, Heart, Swords, Trophy, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { EmptyState } from "@/components/EmptyState";

interface ActivityEntry {
  id: string;
  event_type: string;
  description: string;
  xp_amount: number;
  created_at: string;
}

const EVENT_CONFIG: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  xp_gain:         { icon: Zap,        color: "text-primary",                     label: "XP Gained"        },
  xp_awarded:      { icon: Zap,        color: "text-primary",                     label: "XP Awarded"       },
  buff:            { icon: Shield,     color: "text-secondary",                   label: "Buff Applied"     },
  debuff:          { icon: ShieldOff,  color: "text-destructive",                 label: "Debuff"           },
  loot:            { icon: Package,    color: "text-[hsl(var(--neon-cyan))]",     label: "Loot Drop"        },
  // Quests (task_* is legacy naming — app uses quests)
  quest_created:   { icon: Target,     color: "text-[hsl(var(--neon-gold))]",     label: "Quest Created"    },
  task_created:    { icon: Target,     color: "text-[hsl(var(--neon-gold))]",     label: "Quest Created"    },
  quest_complete:  { icon: Star,       color: "text-primary",                     label: "Quest Complete"   },
  quest_completed: { icon: Star,       color: "text-primary",                     label: "Quest Complete"   },
  task_completed:  { icon: Star,       color: "text-primary",                     label: "Quest Complete"   },
  quest_deleted:   { icon: Trash2,     color: "text-destructive",                 label: "Quest Deleted"    },
  // Skills & progression
  codex:           { icon: ScrollText, color: "text-[hsl(var(--neon-purple))]",   label: "Codex Points"     },
  skill_up:        { icon: Zap,        color: "text-[hsl(var(--neon-green))]",    label: "Skill Up"         },
  skill_created:   { icon: Swords,     color: "text-[hsl(var(--neon-green))]",    label: "Skill Unlocked"   },
  stat_up:         { icon: Trophy,     color: "text-[hsl(var(--neon-gold))]",     label: "Stat Up"          },
  // Content
  journal_created: { icon: BookOpen,   color: "text-[hsl(var(--neon-purple))]",   label: "Journal Entry"    },
  vault_created:   { icon: Archive,    color: "text-[hsl(var(--neon-cyan))]",     label: "Vault Entry"      },
  // People & allies
  council_added:   { icon: Users,      color: "text-secondary",                   label: "Council Added"    },
  ally_added:      { icon: Heart,      color: "text-[hsl(var(--neon-green))]",    label: "Ally Added"       },
  ally_deleted:    { icon: Trash2,     color: "text-destructive",                 label: "Ally Removed"     },
  // Items
  item_created:    { icon: Package,    color: "text-[hsl(var(--neon-cyan))]",     label: "Item Created"     },
  item_updated:    { icon: Package,    color: "text-muted-foreground",            label: "Item Updated"     },
  item_deleted:    { icon: Trash2,     color: "text-destructive",                 label: "Item Deleted"     },
  // Other
  energy_created:  { icon: Layers,     color: "text-[hsl(var(--neon-gold))]",     label: "Energy System"    },
  profile_updated: { icon: Shield,     color: "text-muted-foreground",            label: "Profile Updated"  },
};

const FILTERS = [
  "all",
  "xp_gain", "xp_awarded",
  "quest_created", "task_created",
  "quest_complete", "quest_completed", "task_completed",
  "skill_created", "skill_up", "stat_up",
  "journal_created", "vault_created",
  "council_added", "ally_added",
  "item_created",
  "buff", "debuff", "loot", "codex",
];

const PAGE_SIZE = 50;

export default function ActivityLogPage() {
  const { user } = useAuth();
  const { lastActionTs } = useAppData();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const fetchEntries = useCallback(async () => {
    if (!user) return;
    let query = supabase
      .from("activity_log")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filter !== "all") {
      query = query.eq("event_type", filter);
    }

    const { data, count } = await query;
    if (data) setEntries(data as ActivityEntry[]);
    if (count !== null) setTotalCount(count);
    setLoading(false);
  }, [user, filter, page]);

  // Reset to page 0 whenever the filter changes
  useEffect(() => { setPage(0); }, [filter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { if (lastActionTs) fetchEntries(); }, [lastActionTs]); // eslint-disable-line react-hooks/exhaustive-deps

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
            className={`px-2.5 py-1 text-xs font-mono uppercase rounded border transition-all ${
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
          <EmptyState
            icon={ScrollText}
            title="No activity recorded yet"
            description="Complete quests to generate events."
          />
        </HudCard>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([day, items]) => (
            <div key={day}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{day}</span>
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
                          <span className={`text-xs font-mono uppercase ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-xs font-mono text-muted-foreground">{time}</span>
                        </div>
                        <p className="text-xs text-foreground truncate">{entry.description}</p>
                      </div>
                      {entry.xp_amount > 0 && (
                        <span className="text-xs font-mono text-primary whitespace-nowrap">+{entry.xp_amount} XP</span>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-3 mt-4 justify-center">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 text-xs font-mono border border-border text-muted-foreground rounded hover:border-border/80 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Previous
          </button>
          <span className="text-xs font-mono text-muted-foreground">Page {page + 1}</span>
          <button
            disabled={(page + 1) * PAGE_SIZE >= totalCount}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 text-xs font-mono border border-border text-muted-foreground rounded hover:border-border/80 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
