// ============================================================
// VANTARA.EXE — Shared UI Components
// PageHeader | HudCard | ProgressBar | StatBadge | RarityBadge | RankBadge | FieldError | ScanPopover
// ============================================================
import { ReactNode, MouseEvent } from "react";
import { AlertCircle } from "lucide-react";
import { RANK_COLORS, type Rank } from "@/types/rpg";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

// ─── FieldError ────────────────────────────────────────────
// Inline validation error shown beneath a form field.
// Usage: <FieldError message={errors.title} />
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <AlertCircle size={11} className="text-destructive shrink-0" />
      <p className="text-xs font-mono text-destructive">{message}</p>
    </div>
  );
}

// ─── fieldClass ────────────────────────────────────────────
// Returns Tailwind classes for an input/textarea, highlighting red when in error.
export function fieldClass(hasError?: boolean) {
  return cn(
    "w-full bg-muted/30 border rounded px-3 py-2 text-sm font-mono focus:outline-none transition-colors resize-none",
    hasError
      ? "border-destructive/70 focus:border-destructive"
      : "border-border focus:border-primary/40",
  );
}

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
      {actions && <div className="flex items-center gap-2 shrink-0 ml-2">{actions}</div>}
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
      <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest mt-0.5">
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
    <span className={cn("text-xs font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border", style)}>
      {rarity}
    </span>
  );
}

// ─── RankBadge ─────────────────────────────────────────────
export function RankBadge({ rank, size = "sm" }: { rank: string; size?: "xs" | "sm" | "md" }) {
  const color = RANK_COLORS[rank as Rank] ?? "#666";
  const sizeClass = { xs: "text-xs px-1 py-0.5", sm: "text-xs px-1.5 py-0.5", md: "text-xs px-2 py-1" }[size];

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
    <span className={cn("text-xs font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border", style)}>
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
        <span className="text-xs font-mono text-foreground truncate block">{label}</span>
        {status && (
          <span className={cn("text-xs font-mono uppercase", statusColors[status] ?? "text-muted-foreground")}>
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
      <span className="text-xs font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── ScanPopover ───────────────────────────────────────────
// "Scouter"-style click-to-inspect readout — the same idea as the Scouter
// page's PvP assessment (quantify a target, show a short HUD summary),
// applied to any chip: a quest's linked skill, a stat/energy reward, a
// buff/debuff, a loot drop. Wrap a chip in it and it becomes tappable.
// Usage: <ScanPopover label="SKILL" title={sk.name} fields={[...]}>
//          <span className="...chip classes...">🎯 {sk.name}</span>
//        </ScanPopover>
export interface ScanField {
  label: string;
  value: ReactNode;
  color?: string;
}
interface ScanPopoverProps {
  label: string;
  title: string;
  subtitle?: string;
  description?: string;
  fields?: ScanField[];
  accent?: string; // raw hex, e.g. an energy system's color. Defaults to the theme primary.
  children: ReactNode;
}
export function ScanPopover({ label, title, subtitle, description, fields = [], accent, children }: ScanPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span onClick={(e: MouseEvent) => e.stopPropagation()} className="inline-flex cursor-pointer">
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onClick={(e) => e.stopPropagation()}
        className={cn("w-72 p-0 overflow-hidden font-mono", !accent && "border-primary/30")}
        style={accent ? { borderColor: accent + "40" } : undefined}
      >
        <div
          className={cn("px-3 py-1.5 border-b flex items-center gap-1.5", !accent && "border-primary/20 bg-primary/10")}
          style={accent ? { borderColor: accent + "33", background: accent + "14" } : undefined}
        >
          <span
            className={cn("text-[10px] uppercase tracking-widest font-bold", !accent && "text-primary")}
            style={accent ? { color: accent } : undefined}
          >
            ⟡ {label} SCAN
          </span>
        </div>
        <div className="p-3 space-y-2">
          <div>
            <p className="font-display text-sm font-bold text-foreground">{title}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {description && <p className="text-xs font-body text-muted-foreground leading-relaxed">{description}</p>}
          {fields.length > 0 && (
            <div className="space-y-1 pt-1.5 border-t border-border/40">
              {fields.map((f, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-bold" style={f.color ? { color: f.color } : undefined}>{f.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
