import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  Target, Flame, Zap, Sparkles, Package, BookLock, ShoppingBag,
  Medal, TowerControl, Activity, Users, CheckSquare, BookOpen,
  Shield, Cpu, Crown, Copy, TrendingUp, CalendarDays, Radio,
} from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar, StatBadge, RankBadge, QuestTypeBadge } from "@/components/SharedUI";
import { RANK_COLORS } from "@/types/rpg";
import { StreakHeatmap } from "@/components/StreakHeatmap";
import { supabase } from "@/integrations/supabase/client";

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
  const { profile, quests, questStats, journalEntries } = useAppData();

  const rankColor = RANK_COLORS[profile.rank as keyof typeof RANK_COLORS] ?? "#FFD700";
  const xpPct = profile.xp_to_next_level > 0
    ? Math.round((profile.xp / profile.xp_to_next_level) * 100)
    : 0;

  const activeQuests = quests.filter((q) => q.status === "active").slice(0, 4);

  // ── Morning Brief ──
  const [morningBrief, setMorningBrief] = useState<{
    brief_date: string;
    brief_text: string;
  } | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    (supabase as any)
      .from("mavis_daily_briefs")
      .select("brief_date, brief_text")
      .eq("brief_date", today)
      .maybeSingle()
      .then(({ data }: any) => setMorningBrief(data ?? null));
  }, []);

  // ── Market Intel ──
  const [marketIntel, setMarketIntel] = useState<Array<{
    topic: string;
    headline: string;
    summary: string;
    relevance_score: number;
    signal_type: string;
  }>>([]);

  useEffect(() => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    supabase
      .from("mavis_market_intel")
      .select("topic, headline, summary, relevance_score, signal_type")
      .gte("relevance_score", 0.6)
      .gte("created_at", yesterday)
      .order("relevance_score", { ascending: false })
      .limit(3)
      .then(({ data }) => setMarketIntel(data ?? []));
  }, []);

  // ── Action Queue ──
  const [actionQueue, setActionQueue] = useState<Array<{
    id: string;
    action_type: string;
    autonomy_tier: string;
    source_context: string;
    priority: number;
    action_payload: Record<string, any>;
  }>>([]);

  useEffect(() => {
    supabase
      .from("mavis_action_queue")
      .select("id, action_type, autonomy_tier, source_context, priority, action_payload")
      .eq("status", "pending")
      .order("priority", { ascending: true })
      .limit(5)
      .then(({ data }) => setActionQueue((data as any) ?? []));
  }, []);

  // ── Outcome Accuracy ──
  const [outcomeAccuracy, setOutcomeAccuracy] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("mavis_outcome_events")
      .select("outcome_status")
      .not("outcome_status", "eq", "pending")
      .limit(50)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const confirmed = data.filter(e => e.outcome_status === "confirmed").length;
        setOutcomeAccuracy(Math.round((confirmed / data.length) * 100));
      });
  }, []);

  // ── Evolution Log ──
  const [lastEvolution, setLastEvolution] = useState<{
    evolution_type: string;
    affected_key: string;
    reason: string;
  } | null>(null);

  useEffect(() => {
    supabase
      .from("mavis_evolution_log")
      .select("evolution_type, affected_key, reason")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLastEvolution(data ?? null));
  }, []);

  // ── Performance Score ──
  const [perfScore, setPerfScore] = useState<{
    score: number;
    trend: string;
    optimal_window: string;
    recommendation: string;
  } | null>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from("mavis_daily_scores")
      .select("score, trend, optimal_window, recommendation")
      .eq("score_date", today)
      .maybeSingle()
      .then(({ data }) => setPerfScore(data ?? null));
  }, []);

  const scoreColor =
    perfScore === null
      ? "text-muted-foreground"
      : perfScore.score >= 75
      ? "text-green-400"
      : perfScore.score >= 50
      ? "text-amber-400"
      : "text-red-400";

  const trendArrow =
    perfScore?.trend === "improving"
      ? "↑"
      : perfScore?.trend === "declining"
      ? "↓"
      : "→";

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

      {/* ── Today's Intelligence ── */}
      <motion.div {...fadeIn(0.08)}>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
          Today's Intelligence
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Morning Brief Card */}
          <HudCard>
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays size={14} className="text-primary shrink-0" />
              <h3 className="text-sm font-display text-foreground">Morning Brief</h3>
              {morningBrief && (
                <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                  {morningBrief.brief_date}
                </span>
              )}
            </div>
            {morningBrief ? (
              <p className="text-xs font-body text-foreground/80 leading-relaxed">
                {morningBrief.brief_text.length > 400
                  ? morningBrief.brief_text.slice(0, 400) + "..."
                  : morningBrief.brief_text}
              </p>
            ) : (
              <p className="text-xs font-mono text-muted-foreground text-center py-3">
                Brief generates at 6am daily
              </p>
            )}
          </HudCard>

          {/* Performance Score Card */}
          <HudCard>
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-primary shrink-0" />
              <h3 className="text-sm font-display text-foreground">Today's Performance</h3>
            </div>
            {perfScore ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className={`text-3xl font-display font-bold ${scoreColor}`}>
                    {perfScore.score}
                  </span>
                  <span className="text-sm font-mono text-muted-foreground">/100</span>
                  <span className={`text-lg font-mono ${scoreColor}`}>{trendArrow}</span>
                  <span className="text-[10px] font-mono text-muted-foreground capitalize">
                    {perfScore.trend}
                  </span>
                </div>
                {perfScore.optimal_window && (
                  <p className="text-[10px] font-mono text-primary">
                    Peak: {perfScore.optimal_window}
                  </p>
                )}
                {perfScore.recommendation && (
                  <p className="text-xs font-body text-foreground/70 leading-relaxed">
                    {perfScore.recommendation.length > 120
                      ? perfScore.recommendation.slice(0, 120) + "..."
                      : perfScore.recommendation}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs font-mono text-muted-foreground text-center py-3">
                Score generates at 7am daily
              </p>
            )}
          </HudCard>

        </div>
      </motion.div>

      {/* ── Market Intel ── */}
      {marketIntel.length > 0 && (
        <motion.div {...fadeIn(0.05)}>
          <HudCard>
            <div className="flex items-center gap-2 mb-3">
              <Radio size={14} className="text-primary shrink-0" />
              <h3 className="text-sm font-display text-foreground">Market Radar</h3>
              <span className="ml-auto text-[10px] font-mono text-muted-foreground">last 24h</span>
            </div>
            <div className="space-y-3">
              {marketIntel.map((item, i) => (
                <div key={i} className="border-l-2 border-primary/30 pl-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-primary uppercase">{item.signal_type}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">·</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{item.topic}</span>
                    <span className="ml-auto text-[10px] font-mono text-green-400">{Math.round(item.relevance_score * 100)}%</span>
                  </div>
                  <p className="text-xs font-display text-foreground leading-tight">{item.headline}</p>
                  <p className="text-[10px] font-body text-foreground/60 leading-relaxed mt-0.5 line-clamp-2">{item.summary}</p>
                </div>
              ))}
            </div>
          </HudCard>
        </motion.div>
      )}

      {/* ── Autonomous Actions + Intelligence Feedback ── */}
      <motion.div {...fadeIn(0.06)} className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Autonomy Queue */}
        <HudCard>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-amber-400 shrink-0" />
            <h3 className="text-sm font-display text-foreground">Action Queue</h3>
            {actionQueue.length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-amber-400 border border-amber-400/40 rounded px-1">{actionQueue.length} pending</span>
            )}
          </div>
          {actionQueue.length > 0 ? (
            <div className="space-y-2">
              {actionQueue.map((item) => (
                <div key={item.id} className="flex items-start gap-2">
                  <span className={`text-[9px] font-mono px-1 py-0.5 rounded mt-0.5 ${item.autonomy_tier === "auto" ? "bg-green-400/20 text-green-400" : item.autonomy_tier === "queue" ? "bg-amber-400/20 text-amber-400" : "bg-red-400/20 text-red-400"}`}>
                    {item.autonomy_tier}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-mono text-foreground truncate">{item.action_payload?.title ?? item.action_type}</p>
                    <p className="text-[9px] font-body text-muted-foreground truncate">{item.source_context}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground text-center py-3">No pending actions</p>
          )}
        </HudCard>

        {/* Outcome Accuracy */}
        <HudCard>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-primary shrink-0" />
            <h3 className="text-sm font-display text-foreground">Prediction Accuracy</h3>
          </div>
          {outcomeAccuracy !== null ? (
            <div className="flex flex-col items-center justify-center py-2">
              <span className={`text-4xl font-display font-bold ${outcomeAccuracy >= 70 ? "text-green-400" : outcomeAccuracy >= 50 ? "text-amber-400" : "text-red-400"}`}>
                {outcomeAccuracy}%
              </span>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">of predictions confirmed</p>
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground text-center py-3">Tracking accumulates as Mavis operates</p>
          )}
        </HudCard>

        {/* Self-Evolution */}
        <HudCard>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-primary shrink-0" />
            <h3 className="text-sm font-display text-foreground">Self-Evolution</h3>
          </div>
          {lastEvolution ? (
            <div className="space-y-1">
              <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${lastEvolution.evolution_type.includes("added") || lastEvolution.evolution_type.includes("strengthened") ? "bg-green-400/20 text-green-400" : "bg-amber-400/20 text-amber-400"}`}>
                {lastEvolution.evolution_type.replace(/_/g, " ")}
              </span>
              <p className="text-[10px] font-mono text-foreground mt-1">{lastEvolution.affected_key}</p>
              <p className="text-[9px] font-body text-muted-foreground leading-relaxed line-clamp-3">{lastEvolution.reason}</p>
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground text-center py-3">Evolves weekly via self-analysis</p>
          )}
        </HudCard>

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

        {/* Recent Journal */}
        <HudCard>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-display text-foreground">Recent Log</h3>
            <button
              onClick={() => navigate("/journal")}
              className="text-[10px] font-mono text-primary hover:underline"
            >
              View All →
            </button>
          </div>
          <div className="space-y-2">
            {journalEntries.slice(0, 4).map((e) => (
              <div key={e.id} className="flex items-center gap-2 p-2 rounded bg-muted/20 border border-border/50">
                <BookOpen size={12} className="text-blue-400 shrink-0" />
                <span className="text-xs font-body flex-1 truncate">{e.title}</span>
                <span className="text-[10px] font-mono text-green-400 shrink-0">+{e.xp_earned}</span>
              </div>
            ))}
            {journalEntries.length === 0 && (
              <p className="text-xs font-mono text-muted-foreground text-center py-2">No journal entries yet</p>
            )}
          </div>
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

      {/* Streak heatmap */}
      <motion.div {...fadeIn(0.5)}>
        <HudCard>
          <StreakHeatmap />
        </HudCard>
      </motion.div>
    </div>
  );
}
