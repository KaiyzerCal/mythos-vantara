// ============================================================
// VANTARA.EXE — Shared UI Components
// PageHeader | HudCard | ProgressBar | StatBadge | RarityBadge | RankBadge
// ============================================================
import { ReactNode } from "react";
import { RANK_COLORS, type Rank } from "@/types/rpg";
import { cn } from "@/lib/utils";

// ─── PageHeader ────────────────────────────────────────────
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}
export function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6 pb-4 border-b border-border">
      <div className="flex items-center gap-3">
        {icon && (
          <div className="w-9 h-9 rounded bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            {icon}
          </div>
        )}
        <div>
          <h1 className="font-display text-lg font-bold text-glow-gold">{title}</h1>
          {subtitle && <p className="text-xs font-mono text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── HudCard ───────────────────────────────────────────────
interface HudCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: "gold" | "green" | "purple" | "red" | "none";
  onClick?: () => void;
}
export function HudCard({ children, className, glowColor = "none", onClick }: HudCardProps) {
  const glowClass = {
    gold: "hover:border-primary/40 hover:glow-gold",
    green: "hover:border-neon-green/40 hover:glow-green",
    purple: "hover:border-neon-purple/30",
    red: "hover:border-neon-red/30",
    none: "",
  }[glowColor];

  return (
    <div
      onClick={onClick}
      className={cn(
        "hud-border rounded-lg p-4 transition-all duration-200",
        glowClass,
        onClick && "cursor-pointer",
        className
      )}
    >
      {children}
    </div>
  );
}

// ─── ProgressBar ───────────────────────────────────────────
interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  colorClass?: string;
  showPercent?: boolean;
  height?: "xs" | "sm" | "md";
}
export function ProgressBar({
  value, max, label, colorClass = "bg-primary", showPercent = false, height = "sm"
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const heightClass = { xs: "h-0.5", sm: "h-1.5", md: "h-2.5" }[height];

  return (
    <div className="w-full">
      {(label || showPercent) && (
        <div className="flex justify-between mb-1">
          {label && <span className="text-xs font-mono text-muted-foreground">{label}</span>}
          {showPercent && <span className="text-xs font-mono text-muted-foreground">{pct}%</span>}
        </div>
      )}
      <div className={cn("w-full bg-muted rounded-full overflow-hidden", heightClass)}>
        <div
          className={cn("h-full rounded-full transition-all duration-500", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── StatBadge ─────────────────────────────────────────────
interface StatBadgeProps {
  label: string;
  value: number | string;
  color?: string;
  small?: boolean;
}
export function StatBadge({ label, value, color, small = false }: StatBadgeProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center rounded border border-border bg-muted/30 transition-all",
      small ? "px-2 py-1.5" : "px-3 py-2"
    )}>
      <span
        className={cn("font-display font-bold tabular-nums", small ? "text-sm" : "text-base")}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mt-0.5">
        {label}
      </span>
    </div>
  );
}

// ─── RarityBadge ───────────────────────────────────────────
const RARITY_STYLES: Record<string, string> = {
  common: "bg-zinc-700/50 text-zinc-300 border-zinc-600",
  rare: "bg-blue-900/50 text-blue-300 border-blue-700",
  epic: "bg-purple-900/50 text-purple-300 border-purple-700",
  legendary: "bg-amber-900/50 text-amber-300 border-amber-700",
  mythic: "bg-red-900/50 text-red-300 border-red-700",
};

export function RarityBadge({ rarity }: { rarity: string }) {
  const style = RARITY_STYLES[rarity.toLowerCase()] ?? RARITY_STYLES.common;
  return (
    <span className={cn("text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border", style)}>
      {rarity}
    </span>
  );
}

// ─── RankBadge ─────────────────────────────────────────────
export function RankBadge({ rank, size = "sm" }: { rank: string; size?: "xs" | "sm" | "md" }) {
  const color = RANK_COLORS[rank as Rank] ?? "#666";
  const sizeClass = { xs: "text-[8px] px-1 py-0.5", sm: "text-[10px] px-1.5 py-0.5", md: "text-xs px-2 py-1" }[size];

  return (
    <span
      className={cn("font-display font-bold rounded border", sizeClass)}
      style={{ color, borderColor: color + "55", background: color + "11" }}
    >
      {rank}
    </span>
  );
}

// ─── QuestTypeBadge ────────────────────────────────────────
const QUEST_TYPE_STYLES: Record<string, string> = {
  main: "bg-red-900/40 text-red-300 border-red-700",
  epic: "bg-amber-900/40 text-amber-300 border-amber-700",
  side: "bg-blue-900/40 text-blue-300 border-blue-700",
  daily: "bg-green-900/40 text-green-300 border-green-700",
};
export function QuestTypeBadge({ type }: { type: string }) {
  const style = QUEST_TYPE_STYLES[type] ?? QUEST_TYPE_STYLES.side;
  return (
    <span className={cn("text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border", style)}>
      {type}
    </span>
  );
}

// ─── EnergyBar ─────────────────────────────────────────────
interface EnergyBarProps {
  label: string;
  current: number;
  max: number;
  color: string;
  status?: string;
}
export function EnergyBar({ label, current, max, color, status }: EnergyBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  const statusColors: Record<string, string> = {
    mastered: "text-primary",
    perfect: "text-neon-green",
    advanced: "text-neon-cyan",
    developing: "text-muted-foreground",
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 shrink-0">
        <span className="text-[10px] font-mono text-foreground/80 truncate block">{label}</span>
        {status && (
          <span className={cn("text-[8px] font-mono uppercase", statusColors[status] ?? "text-muted-foreground")}>
            {status}
          </span>
        )}
      </div>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}
