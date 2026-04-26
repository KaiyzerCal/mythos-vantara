import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Crown, Brain, Target, Flame, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Mode config (mirrors MAVIS_MODES in MavisChat) ────────────────────────────

const MODE_CFG: Record<string, { label: string; color: string; Icon: any }> = {
  PRIME:      { label: "PRIME",       color: "text-primary",     Icon: Crown },
  ARCH:       { label: "ARCHITECT",   color: "text-purple-400",  Icon: Brain },
  QUEST:      { label: "QUEST",       color: "text-red-400",     Icon: Target },
  FORGE:      { label: "FORGE",       color: "text-orange-400",  Icon: Flame },
  CODEX:      { label: "CODEX",       color: "text-cyan-400",    Icon: Zap },
  SOVEREIGN:  { label: "SOVEREIGN",   color: "text-amber-400",   Icon: Crown },
  ENRYU:      { label: "ENRYU",       color: "text-red-500",     Icon: Flame },
  WATCHTOWER: { label: "WATCHTOWER",  color: "text-emerald-400", Icon: Zap },
};

// ── Session data type ─────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  mode: string;
  messages: any[];
  startTime?: Date;
  endTime?: Date;
}

// Groups a flat message array into mode-contiguous sessions.
// Messages with id === "init" are skipped (rendered separately).
export function groupMessagesIntoSessions(messages: any[]): ChatSession[] {
  const sessions: ChatSession[] = [];
  let current: ChatSession | null = null;

  for (const msg of messages) {
    if (msg.id === "init") continue;
    const mode = (msg.mode ?? "PRIME") as string;

    if (!current || current.mode !== mode) {
      current = {
        id: `session-${sessions.length}-${mode}`,
        mode,
        messages: [],
        startTime: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
      };
      sessions.push(current);
    }
    current.messages.push(msg);
    current.endTime = msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp);
  }

  return sessions;
}

// ── SessionBlock component ────────────────────────────────────────────────────

interface SessionBlockProps {
  session: ChatSession;
  isLive?: boolean;
  hasVoice?: boolean;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

export function SessionBlock({
  session,
  isLive = false,
  hasVoice = false,
  defaultExpanded = false,
  children,
}: SessionBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cfg = MODE_CFG[session.mode] ?? MODE_CFG.PRIME;
  const { Icon, label, color } = cfg;

  const timeStr = session.startTime
    ? session.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const msgCount = session.messages.length;

  return (
    <div className={cn(
      "rounded-lg border overflow-hidden transition-colors",
      isLive ? "border-border" : "border-border/40"
    )}>
      {/* ── Header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
          "bg-muted/15 hover:bg-muted/30",
          expanded && "border-b border-border/40"
        )}
      >
        {/* Chevron */}
        {expanded
          ? <ChevronDown size={10} className="text-muted-foreground/60 shrink-0" />
          : <ChevronRight size={10} className="text-muted-foreground/60 shrink-0" />
        }

        {/* Mode icon + label */}
        <Icon size={11} className={cn(color, "shrink-0")} />
        <span className={cn("text-[10px] font-mono font-bold tracking-wide", color)}>
          {label}
        </span>

        {/* Message count */}
        <span className="text-[9px] font-mono text-muted-foreground/50 bg-muted/40 rounded px-1.5 py-px">
          {msgCount}
        </span>

        {/* Timestamp */}
        {timeStr && (
          <span className="text-[9px] font-mono text-muted-foreground/35">
            {timeStr}
          </span>
        )}

        {/* Right side: voice dot + live badge */}
        <div className="ml-auto flex items-center gap-2">
          {hasVoice && (
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                isLive
                  ? "bg-neon-green animate-pulse"
                  : "bg-muted-foreground/30"
              )}
              title={isLive ? "Voice active" : "Voice was used"}
            />
          )}
          {isLive && (
            <span className="text-[8px] font-mono text-neon-green border border-neon-green/25 rounded px-1 py-px">
              LIVE
            </span>
          )}
        </div>
      </button>

      {/* ── Messages ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
