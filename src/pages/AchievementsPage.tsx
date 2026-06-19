// ============================================================
// VANTARA.EXE — AchievementsPage
// Achievement / badge gallery with catalog and unlock tracking
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, X, Loader2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";

// ─── Types ──────────────────────────────────────────────────
interface Achievement {
  id: string;
  achievement_key: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  unlocked_at: string;
  data: Record<string, unknown>;
}

interface CatalogEntry {
  key: string;
  title: string;
  description: string;
  icon: string;
  category: string;
}

// ─── Catalog (matches edge function ACHIEVEMENTS list) ──────
const ACHIEVEMENT_CATALOG: CatalogEntry[] = [
  // Quests
  { key: "first_quest",    title: "First Blood",     description: "Complete your first quest",             icon: "⚔️",  category: "quests"    },
  { key: "quest_10",       title: "Veteran",         description: "Complete 10 quests",                    icon: "🎖️",  category: "quests"    },
  { key: "quest_50",       title: "Legend",          description: "Complete 50 quests",                    icon: "🏅",  category: "quests"    },
  // Habits
  { key: "streak_7",       title: "Week Warrior",    description: "Maintain a 7-day habit streak",         icon: "🔥",  category: "habits"    },
  { key: "streak_30",      title: "Iron Will",       description: "Maintain a 30-day habit streak",        icon: "💪",  category: "habits"    },
  { key: "streak_100",     title: "Centurion",       description: "100-day streak",                        icon: "💯",  category: "habits"    },
  // Finance
  { key: "first_revenue",  title: "First Dollar",    description: "Log your first revenue",                icon: "💰",  category: "finance"   },
  { key: "revenue_1k",     title: "Four Figures",    description: "Log $1,000 in total revenue",           icon: "💵",  category: "finance"   },
  { key: "revenue_10k",    title: "Five Figures",    description: "Log $10,000 in total revenue",          icon: "💸",  category: "finance"   },
  // Knowledge
  { key: "vault_10",       title: "Archivist",       description: "Add 10 notes to the Vault",             icon: "📚",  category: "knowledge" },
  { key: "vault_100",      title: "Scholar",         description: "100 vault notes",                       icon: "🎓",  category: "knowledge" },
  // Social
  { key: "first_post",     title: "Signal Sent",     description: "Publish your first social post as Nora",icon: "📡",  category: "social"    },
  { key: "post_50",        title: "Broadcaster",     description: "50 social posts",                       icon: "📢",  category: "social"    },
  // Bond
  { key: "bond_50",        title: "Trusted",         description: "Reach Bond Level 50 with MAVIS",        icon: "🤝",  category: "bond"      },
  { key: "bond_100",       title: "Sovereign Bond",  description: "Maximum bond with MAVIS",               icon: "👑",  category: "bond"      },
  // Special
  { key: "all_platforms",  title: "Omni-Signal",     description: "Post to 4+ social platforms",           icon: "🌐",  category: "special"   },
];

const CATEGORIES = ["all", "quests", "habits", "finance", "social", "knowledge", "bond", "special"] as const;
type CategoryFilter = typeof CATEGORIES[number];

// ─── Helpers ────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── AchievementsPage ────────────────────────────────────────
export function AchievementsPage() {
  const { user } = useAuth();
  const [unlocked, setUnlocked] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Achievement | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  // ─── Fetch unlocked achievements ────────────────────────
  const fetchAchievements = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("achievements")
      .select("*")
      .eq("user_id", user.id)
      .order("unlocked_at", { ascending: false });

    if (!error && data) {
      setUnlocked(
        (data as Achievement[]).map((a) => ({
          ...a,
          data: (a.data as Record<string, unknown>) ?? {},
        }))
      );
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchAchievements();
  }, [fetchAchievements]);

  // ─── Build unlocked map ──────────────────────────────────
  const unlockedMap: Record<string, Achievement> = {};
  for (const a of unlocked) {
    unlockedMap[a.achievement_key] = a;
  }

  // ─── Filter catalog ──────────────────────────────────────
  const filteredCatalog = ACHIEVEMENT_CATALOG.filter(
    (e) => categoryFilter === "all" || e.category === categoryFilter
  );

  const unlockedCount = unlocked.length;
  const totalCount = ACHIEVEMENT_CATALOG.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Achievements"
        subtitle={`${unlockedCount} / ${totalCount} unlocked`}
        icon={<Trophy size={18} />}
      />

      {/* ── Progress bar ─────────────────────────────────── */}
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            {unlockedCount} / {totalCount} achievements unlocked
          </span>
          <span className="text-xs font-mono text-primary">
            {totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0}%
          </span>
        </div>
        <ProgressBar value={unlockedCount} max={totalCount} colorClass="bg-primary/70" height="md" />
      </div>

      {/* ── Category filter ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1 text-xs font-mono rounded border transition-colors capitalize ${
              categoryFilter === cat
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:border-border/80"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* ── Achievement Grid ─────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-primary" size={20} />
        </div>
      ) : filteredCatalog.length === 0 ? (
        <HudCard className="text-center py-10">
          <Trophy size={32} className="text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-mono text-muted-foreground">
            Complete quests, build habits, and grow your revenue to unlock achievements.
          </p>
        </HudCard>
      ) : (
        <motion.div
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.04 } },
            hidden: {},
          }}
        >
          {filteredCatalog.map((entry) => {
            const unlockedData = unlockedMap[entry.key];
            const isUnlocked = !!unlockedData;

            return (
              <motion.div
                key={entry.key}
                variants={{
                  hidden: { opacity: 0, y: 12, scale: 0.96 },
                  visible: { opacity: 1, y: 0, scale: 1 },
                }}
                transition={{ duration: 0.25 }}
              >
                <HudCard
                  glowColor={isUnlocked ? "gold" : "none"}
                  onClick={
                    isUnlocked ? () => setSelected(unlockedData) : undefined
                  }
                  className={`relative text-center py-5 ${
                    isUnlocked
                      ? "cursor-pointer"
                      : "grayscale opacity-40"
                  }`}
                >
                  {/* Lock overlay for locked achievements */}
                  {!isUnlocked && (
                    <div className="absolute top-2 right-2">
                      <Lock size={10} className="text-muted-foreground" />
                    </div>
                  )}

                  {/* Icon */}
                  <div className="text-3xl mb-2 leading-none">{entry.icon}</div>

                  {/* Title */}
                  <p
                    className={`text-xs font-display font-bold mb-1 ${
                      isUnlocked ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {entry.title}
                  </p>

                  {/* Description */}
                  <p className="text-xs font-mono text-muted-foreground leading-tight">
                    {entry.description}
                  </p>

                  {/* Unlocked date */}
                  {isUnlocked && (
                    <p className="text-xs font-mono text-primary mt-2">
                      {fmtDate(unlockedData.unlocked_at)}
                    </p>
                  )}

                  {/* Category label */}
                  <p className="text-[7px] font-mono text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                    {entry.category}
                  </p>
                </HudCard>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ── Detail Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {selected && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-40"
              onClick={() => setSelected(null)}
            />

            {/* Panel */}
            <motion.div
              key="panel"
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="pointer-events-auto w-full max-w-sm">
                <HudCard glowColor="gold" className="relative text-center py-8 px-6">
                  <button
                    onClick={() => setSelected(null)}
                    className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X size={14} />
                  </button>

                  <div className="text-5xl mb-4">{selected.icon}</div>

                  <p className="text-lg font-display font-bold text-primary mb-1">
                    {selected.title}
                  </p>

                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4">
                    {selected.category}
                  </p>

                  <p className="text-sm font-mono text-foreground mb-6">
                    {selected.description}
                  </p>

                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/30 bg-primary/10">
                    <Trophy size={11} className="text-primary" />
                    <span className="text-xs font-mono text-primary">
                      Unlocked {fmtDate(selected.unlocked_at)}
                    </span>
                  </div>
                </HudCard>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
