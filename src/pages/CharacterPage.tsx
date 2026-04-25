import { motion } from "framer-motion";
import { Crown, Copy, User, Zap, Star, Shield, Flame, Activity, TrendingUp } from "lucide-react";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard, ProgressBar, StatBadge, RankBadge, EnergyBar } from "@/components/SharedUI";
import { AvatarUploader } from "@/components/AvatarUploader";
import { RANK_COLORS, calculateXPForLevel } from "@/types/rpg";
import { useState } from "react";

const fadeIn = (delay = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, delay },
});

const CORE_STATS = [
  { key: "stat_str", label: "STR", desc: "Strength / Physical power" },
  { key: "stat_agi", label: "AGI", desc: "Agility / Speed / Reflexes" },
  { key: "stat_vit", label: "VIT", desc: "Vitality / Endurance / Resilience" },
  { key: "stat_int", label: "INT", desc: "Intelligence / Processing / Analysis" },
  { key: "stat_wis", label: "WIS", desc: "Wisdom / Judgment / Foresight" },
  { key: "stat_cha", label: "CHA", desc: "Charisma / Influence / Presence" },
  { key: "stat_lck", label: "LCK", desc: "Luck / Synchronicity / Fate" },
] as const;

const STAT_MAX = 100;

export default function CharacterPage() {
  const { profile, quests, skills, energySystems } = useAppData();
  const [copied, setCopied] = useState(false);

  const rankColor = RANK_COLORS[profile.rank as keyof typeof RANK_COLORS] ?? "#FFD700";
  const questsCompleted = quests.filter((q) => q.status === "completed").length;
  const unlockedSkills = skills.filter((s) => s.unlocked).length;
  const totalXPEarned = (profile.level - 1) * calculateXPForLevel(profile.level) + profile.xp;

  const copySheet = () => {
    const lines = [
      `═══ CHARACTER SHEET ═══`,
      `${profile.inscribed_name}`,
      `Title: ${profile.titles[0]}`,
      `Species: ${profile.species_lineage[profile.species_lineage.length - 1]}`,
      `Aura: ${profile.aura}`,
      ``,
      `Level: ${profile.level} | Rank: ${profile.rank}`,
      `GPR: ${profile.gpr} | PVP: ${profile.pvp_rating}`,
      `Floor: ${profile.current_floor} | XP Total: ${totalXPEarned.toLocaleString()}`,
      ``,
      `STR: ${profile.stat_str} | INT: ${profile.stat_int} | VIT: ${profile.stat_vit}`,
      `AGI: ${profile.stat_agi} | WIS: ${profile.stat_wis} | CHA: ${profile.stat_cha} | LCK: ${profile.stat_lck}`,
      ``,
      `Form: ${profile.current_form} | BPM: ${profile.current_bpm}`,
      `Sync: ${profile.full_cowl_sync}% | Fatigue: ${profile.fatigue}/100`,
      `Codex Integrity: ${profile.codex_integrity}%`,
      ``,
      `Quests Completed: ${questsCompleted} | Skills Unlocked: ${unlockedSkills}`,
      `Arc: ${profile.arc_story}`,
    ].join("\n");

    navigator.clipboard.writeText(lines);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Character Sheet"
        subtitle="Operator Identity & Stat Overview"
        icon={<User size={18} />}
        actions={
          <button
            onClick={copySheet}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border hover:border-primary/40 hover:text-primary rounded transition-all"
          >
            <Copy size={12} />
            {copied ? "Copied!" : "Copy All"}
          </button>
        }
      />

      {/* Identity Block */}
      <motion.div {...fadeIn(0)}>
        <HudCard className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            <div
              className="w-20 h-20 rounded-xl border-2 flex items-center justify-center shrink-0"
              style={{ borderColor: rankColor + "77", background: rankColor + "11" }}
            >
              <Crown size={40} style={{ color: rankColor }} />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="font-display text-2xl font-bold" style={{ color: rankColor }}>
                  {profile.inscribed_name}
                </h2>
                <RankBadge rank={profile.rank} size="md" />
              </div>
              {profile.titles.map((t, i) => (
                <p key={i} className="text-xs font-mono text-muted-foreground">
                  {i === 0 ? "⌖" : "◦"} {t}
                </p>
              ))}
              <p className="text-xs font-mono text-muted-foreground mt-1">
                Species: {profile.species_lineage.join(" → ")}
              </p>
              <p className="text-xs font-mono text-primary/70 mt-0.5">
                Aura: {profile.aura}
              </p>
              <p className="text-xs font-mono text-muted-foreground mt-0.5">
                Territory: {profile.territory_class} | {profile.territory_floors}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-3xl font-display font-bold" style={{ color: rankColor }}>
                {profile.level}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Level</p>
              <p className="text-xs font-mono text-muted-foreground mt-2">
                Floor {profile.current_floor}
              </p>
              <p className="text-xs font-mono text-muted-foreground">
                {profile.current_bpm} BPM
              </p>
            </div>
          </div>

          {/* XP Progress */}
          <div className="mt-4 relative">
            <div className="flex justify-between mb-1.5">
              <span className="text-[10px] font-mono text-muted-foreground">
                XP PROGRESS — Level {profile.level} → {profile.level + 1}
              </span>
              <span className="text-[10px] font-mono text-primary">
                {profile.xp.toLocaleString()} / {profile.xp_to_next_level.toLocaleString()}
              </span>
            </div>
            <ProgressBar value={profile.xp} max={profile.xp_to_next_level} height="md" />
          </div>
        </HudCard>
      </motion.div>

      {/* ── Combat Stats ── */}
      <motion.div {...fadeIn(0.05)}>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
          <Star size={10} className="text-primary" /> Core Attributes
        </h3>
        <HudCard>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatBadge label="STR" value={profile.stat_str} />
            <StatBadge label="INT" value={profile.stat_int} />
            <StatBadge label="VIT" value={profile.stat_vit} />
            <StatBadge label="AGI" value={profile.stat_agi} />
            <StatBadge label="WIS" value={profile.stat_wis} />
            <StatBadge label="CHA" value={profile.stat_cha} />
            <StatBadge label="LCK" value={profile.stat_lck} />
            <StatBadge label="SYNC" value={`${profile.full_cowl_sync}%`} color="#FFD700" />
          </div>
          {/* Stat bars */}
          <div className="space-y-2.5">
            {CORE_STATS.map(({ key, label, desc }) => (
              <div key={key} className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-muted-foreground w-8 shrink-0">{label}</span>
                <div className="flex-1">
                  <ProgressBar value={(profile as any)[key]} max={STAT_MAX} height="sm" />
                </div>
                <span className="text-[10px] font-mono text-primary w-6 text-right shrink-0">
                  {(profile as any)[key]}
                </span>
              </div>
            ))}
          </div>
        </HudCard>
      </motion.div>

      {/* ── System State ── */}
      <motion.div {...fadeIn(0.1)}>
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
          <Activity size={10} className="text-primary" /> System State
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <HudCard>
            <p className="text-xs font-mono text-muted-foreground mb-3 uppercase">Combat Metrics</p>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs font-mono text-muted-foreground">Full Cowl Sync</span>
                <span className="text-xs font-mono text-primary">{profile.full_cowl_sync}%</span>
              </div>
              <ProgressBar value={profile.full_cowl_sync} max={100} colorClass="bg-primary" height="xs" />
              <div className="flex justify-between mt-2">
                <span className="text-xs font-mono text-muted-foreground">Codex Integrity</span>
                <span className="text-xs font-mono text-green-400">{profile.codex_integrity}%</span>
              </div>
              <ProgressBar value={profile.codex_integrity} max={100} colorClass="bg-green-500" height="xs" />
              <div className="flex justify-between mt-2">
                <span className="text-xs font-mono text-muted-foreground">Fatigue</span>
                <span className={`text-xs font-mono ${profile.fatigue > 50 ? "text-red-400" : "text-green-400"}`}>
                  {profile.fatigue}/100
                </span>
              </div>
              <ProgressBar
                value={profile.fatigue} max={100}
                colorClass={profile.fatigue > 70 ? "bg-red-500" : profile.fatigue > 40 ? "bg-amber-500" : "bg-green-500"}
                height="xs"
              />
            </div>
          </HudCard>

          <HudCard>
            <p className="text-xs font-mono text-muted-foreground mb-3 uppercase">Rating</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-muted-foreground">GPR Rating</span>
                <span className="text-sm font-display font-bold text-amber-400">
                  {profile.gpr.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-muted-foreground">PVP Rating</span>
                <span className="text-sm font-display font-bold text-red-400">
                  {profile.pvp_rating.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-muted-foreground">Tower Floor</span>
                <span className="text-sm font-display font-bold text-violet-400">
                  {profile.current_floor}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-muted-foreground">Total XP Earned</span>
                <span className="text-xs font-mono text-primary">
                  {totalXPEarned.toLocaleString()}
                </span>
              </div>
            </div>
          </HudCard>
        </div>
      </motion.div>

      {/* ── Energy Systems preview ── */}
      {energySystems.length > 0 && (
        <motion.div {...fadeIn(0.15)}>
          <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
            <Zap size={10} className="text-primary" /> Energy Systems
          </h3>
          <HudCard>
            <div className="space-y-2.5">
              {energySystems.slice(0, 6).map((e) => (
                <EnergyBar
                  key={e.id}
                  label={e.type}
                  current={e.current_value}
                  max={e.max_value}
                  color={e.color}
                  status={e.status}
                />
              ))}
            </div>
            {energySystems.length > 6 && (
              <p className="text-[10px] font-mono text-muted-foreground mt-2 text-center">
                +{energySystems.length - 6} more — see Energy page
              </p>
            )}
          </HudCard>
        </motion.div>
      )}

      {/* ── Arc Story ── */}
      <motion.div {...fadeIn(0.2)}>
        <HudCard className="border-primary/10">
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Current Arc</p>
          <p className="text-sm font-display text-primary/80 italic">{profile.arc_story}</p>
          <p className="text-xs font-mono text-muted-foreground mt-2">
            Form: <span className="text-foreground">{profile.current_form}</span>
          </p>
        </HudCard>
      </motion.div>
    </div>
  );
}
