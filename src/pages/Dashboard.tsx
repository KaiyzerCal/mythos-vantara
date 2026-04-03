import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Target, Flame, Zap, Sparkles, Package, BookLock, ShoppingBag,
  Medal, TowerControl, Activity, Users, CheckSquare, BookOpen,
  Shield, Cpu, Crown, Copy, TrendingUp,
} from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar, StatBadge, RankBadge, QuestTypeBadge } from "@/components/SharedUI";
import { RANK_COLORS } from "@/types/rpg";

const fadeIn = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, delay },
});

const QUICK_ACCESS = [
  { name: "MAVIS", icon: Cpu, to: "/mavis", color: "text-primary" },
  { name: "Quests", icon: Target, to: "/quests", color: "text-red-400" },
  { name: "Forms", icon: Flame, to: "/forms", color: "text-orange-400" },
  { name: "Energy", icon: Zap, to: "/energy", color: "text-cyan-400" },
  { name: "Skills", icon: Sparkles, to: "/skills", color: "text-pink-400" },
  { name: "Inventory", icon: Package, to: "/inventory", color: "text-amber-400" },
  { name: "Vault", icon: BookLock, to: "/vault", color: "text-red-600" },
  { name: "Councils", icon: Users, to: "/councils", color: "text-purple-400" },
  { name: "Scouter", icon: Shield, to: "/scouter", color: "text-green-400" },
  { name: "Journal", icon: BookOpen, to: "/journal", color: "text-blue-400" },
  { name: "Rankings", icon: Medal, to: "/rankings", color: "text-amber-500" },
  { name: "Tower", icon: TowerControl, to: "/tower", color: "text-violet-400" },
  { name: "Scouter", icon: Shield, to: "/scouter", color: "text-emerald-400" },
  { name: "BPM", icon: Activity, to: "/bpm", color: "text-rose-400" },
  { name: "Store", icon: ShoppingBag, to: "/store", color: "text-yellow-400" },
];

const CORE_STATS = [
  { key: "stat_str", label: "STR" },
  { key: "stat_agi", label: "AGI" },
  { key: "stat_vit", label: "VIT" },
  { key: "stat_int", label: "INT" },
  { key: "stat_wis", label: "WIS" },
  { key: "stat_cha", label: "CHA" },
  { key: "stat_lck", label: "LCK" },
] as const;

export default function Dashboard() {
  const navigate = useNavigate();
  const { profile, quests, questStats, tasks, journalEntries } = useAppData();

  const rankColor = RANK_COLORS[profile.rank as keyof typeof RANK_COLORS] ?? "#FFD700";
  const xpPct = profile.xp_to_next_level > 0
    ? Math.round((profile.xp / profile.xp_to_next_level) * 100)
    : 0;

  const activeQuests = quests.filter((q) => q.status === "active").slice(0, 4);
  const activeTasks = tasks.filter((t) => t.status === "active").slice(0, 4);

  const copyStats = () => {
    const text = [
      `${profile.inscribed_name} — Level ${profile.level} [${profile.rank}] Rank`,
      `XP: ${profile.xp}/${profile.xp_to_next_level}`,
      `Form: ${profile.current_form} (${profile.current_bpm} BPM)`,
      `Floor: ${profile.current_floor} | Sync: ${profile.full_cowl_sync}%`,
      `STR ${profile.stat_str} AGI ${profile.stat_agi} VIT ${profile.stat_vit}`,
      `INT ${profile.stat_int} WIS ${profile.stat_wis} CHA ${profile.stat_cha} LCK ${profile.stat_lck}`,
      `GPR: ${profile.gpr} | PVP: ${profile.pvp_rating}`,
      `Arc: ${profile.arc_story}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Black Sun Monarch"
        subtitle="CodexOS v21.1 // VANTARA.EXE"
        icon={<Crown size={18} />}
        actions={
          <button
            onClick={copyStats}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-primary border border-border hover:border-primary/40 rounded transition-all"
          >
            <Copy size={12} /> Copy Stats
          </button>
        }
      />

      {/* ── Identity Card ── */}
      <motion.div {...fadeIn(0)}>
        <HudCard className="relative overflow-hidden scan-overlay">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center gap-4">
            {/* Avatar placeholder */}
            <div
              className="w-16 h-16 rounded-lg border-2 flex items-center justify-center shrink-0"
              style={{ borderColor: rankColor + "66", background: rankColor + "11" }}
            >
              <Crown size={32} style={{ color: rankColor }} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-xl font-bold" style={{ color: rankColor }}>
                  {profile.inscribed_name}
                </h2>
                <RankBadge rank={profile.rank} size="md" />
              </div>
              <p className="text-xs font-mono text-muted-foreground mt-0.5">
                {profile.titles[0]} • {profile.species_lineage[profile.species_lineage.length - 1]}
              </p>
              <p className="text-xs font-mono text-muted-foreground">
                {profile.territory_class} Territory • Floor {profile.current_floor}
              </p>
              <p className="text-[10px] font-mono text-primary/60 mt-1 italic">{profile.arc_story}</p>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-2xl font-display font-bold text-primary">{profile.level}</p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Level</p>
              <p className="text-xs font-mono text-muted-foreground mt-1">
                {profile.current_bpm} BPM
              </p>
            </div>
          </div>

          {/* XP bar */}
          <div className="mt-4">
            <div className="flex justify-between mb-1">
              <span className="text-[10px] font-mono text-muted-foreground">
                XP — {profile.xp.toLocaleString()} / {profile.xp_to_next_level.toLocaleString()}
              </span>
              <span className="text-[10px] font-mono text-primary">{xpPct}%</span>
            </div>
            <ProgressBar value={profile.xp} max={profile.xp_to_next_level} colorClass="bg-primary" height="sm" />
          </div>

          {/* Sub-stats */}
          <div className="mt-3 flex gap-4 flex-wrap">
            <span className="text-[10px] font-mono text-muted-foreground">
              SYNC <span className="text-primary">{profile.full_cowl_sync}%</span>
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              CODEX <span className="text-green-400">{profile.codex_integrity}%</span>
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              GPR <span className="text-amber-400">{profile.gpr.toLocaleString()}</span>
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              PVP <span className="text-red-400">{profile.pvp_rating.toLocaleString()}</span>
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              FATIGUE <span className={profile.fatigue > 50 ? "text-red-400" : "text-green-400"}>
                {profile.fatigue}/100
              </span>
            </span>
          </div>
        </HudCard>
      </motion.div>

      {/* ── Core Stats ── */}
      <motion.div {...fadeIn(0.05)}>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
          Core Attributes
        </h3>
        <div className="grid grid-cols-7 gap-2">
          {CORE_STATS.map(({ key, label }) => (
            <StatBadge key={key} label={label} value={(profile as any)[key]} />
          ))}
        </div>
      </motion.div>

      {/* ── Quest Stats + Active Quests ── */}
      <motion.div {...fadeIn(0.1)} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quest overview */}
        <HudCard>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-display text-foreground">Quest Status</h3>
            <button
              onClick={() => navigate("/quests")}
              className="text-[10px] font-mono text-primary hover:underline"
            >
              View All →
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center p-2 rounded bg-muted/30 border border-border">
              <p className="text-lg font-display font-bold text-primary">{questStats.active}</p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Active</p>
            </div>
            <div className="text-center p-2 rounded bg-muted/30 border border-border">
              <p className="text-lg font-display font-bold text-green-400">{questStats.completed}</p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Done</p>
            </div>
            <div className="text-center p-2 rounded bg-muted/30 border border-border">
              <p className="text-lg font-display font-bold text-amber-400">{questStats.xpEarned.toLocaleString()}</p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">XP Earned</p>
            </div>
          </div>
          <div className="space-y-2">
            {activeQuests.map((q) => (
              <div key={q.id} className="flex items-center gap-2 p-2 rounded bg-muted/20 border border-border/50">
                <QuestTypeBadge type={q.type} />
                <span className="text-xs font-body flex-1 truncate">{q.title}</span>
                <span className="text-[10px] font-mono text-primary shrink-0">+{q.xp_reward} XP</span>
              </div>
            ))}
            {activeQuests.length === 0 && (
              <p className="text-xs font-mono text-muted-foreground text-center py-2">No active quests</p>
            )}
          </div>
        </HudCard>

        {/* Active Tasks */}
        <HudCard>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-display text-foreground">Active Tasks</h3>
            <button
              onClick={() => navigate("/tasks")}
              className="text-[10px] font-mono text-primary hover:underline"
            >
              View All →
            </button>
          </div>
          <div className="space-y-2">
            {activeTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-2 p-2 rounded bg-muted/20 border border-border/50">
                <CheckSquare size={12} className={t.status === "completed" ? "text-green-400" : "text-muted-foreground"} />
                <span className="text-xs font-body flex-1 truncate">{t.title}</span>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0 capitalize">{t.recurrence}</span>
                <span className="text-[10px] font-mono text-primary shrink-0">+{t.xp_reward}</span>
              </div>
            ))}
            {activeTasks.length === 0 && (
              <p className="text-xs font-mono text-muted-foreground text-center py-2">No active tasks</p>
            )}
          </div>
          {/* Recent journal */}
          {journalEntries.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-mono text-muted-foreground uppercase">Recent Log</p>
                <button onClick={() => navigate("/journal")} className="text-[10px] font-mono text-primary hover:underline">
                  View →
                </button>
              </div>
              {journalEntries.slice(0, 2).map((e) => (
                <div key={e.id} className="flex items-center gap-2 py-1">
                  <BookOpen size={10} className="text-blue-400 shrink-0" />
                  <span className="text-[10px] font-body text-muted-foreground truncate">{e.title}</span>
                  <span className="text-[10px] font-mono text-green-400 ml-auto shrink-0">+{e.xp_earned}</span>
                </div>
              ))}
            </div>
          )}
        </HudCard>
      </motion.div>

      {/* ── Quick Access Grid ── */}
      <motion.div {...fadeIn(0.15)}>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
          Quick Access
        </h3>
        <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-15 gap-2">
          {QUICK_ACCESS.map(({ name, icon: Icon, to, color }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-all group"
            >
              <Icon size={18} className={`${color} group-hover:scale-110 transition-transform`} />
              <span className="text-[9px] font-mono text-muted-foreground group-hover:text-foreground uppercase tracking-wide">
                {name}
              </span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* ── System Status ── */}
      <motion.div {...fadeIn(0.2)}>
        <HudCard className="border-primary/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TrendingUp size={14} className="text-primary" />
              <span className="text-xs font-mono text-muted-foreground">SYSTEM STATUS</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-mono text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                MAVIS ONLINE
              </span>
              <span className="text-[10px] font-mono text-primary flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
                CODEXOS ACTIVE
              </span>
            </div>
          </div>
        </HudCard>
      </motion.div>
    </div>
  );
}
