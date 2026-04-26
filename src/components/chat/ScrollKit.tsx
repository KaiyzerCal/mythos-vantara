import { useRef, useState, useCallback } from "react";
import { ArrowUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface ScrollKitState {
  scrollRef: React.RefObject<HTMLDivElement>;
  progress: number;
  showBackToTop: boolean;
  showBackToBottom: boolean;
  handleScroll: () => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
}

export function useScrollKit(): ScrollKitState {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showBackToBottom, setShowBackToBottom] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const scrollable = scrollHeight - clientHeight;
    setProgress(scrollable > 0 ? Math.round((scrollTop / scrollable) * 100) : 100);
    setShowBackToTop(scrollTop > 200);
    setShowBackToBottom(scrollHeight - scrollTop - clientHeight > 120);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  return { scrollRef, progress, showBackToTop, showBackToBottom, handleScroll, scrollToTop, scrollToBottom };
}

// ── Scroll progress bar ───────────────────────────────────────────────────────
// Renders as a thin line at the very top of its containing element.
// Place inside a `position: relative` wrapper.

export function ScrollProgressBar({ progress, className }: { progress: number; className?: string }) {
  return (
    <div className={cn("absolute top-0 left-0 right-0 h-px bg-border/30 z-20 pointer-events-none", className)}>
      <div
        className="h-full bg-primary/70 transition-[width] duration-100 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ── Back-to-top button ────────────────────────────────────────────────────────
// Appears as a small pill at the top-center of the scroll area.

export function BackToTopButton({
  visible,
  onClick,
  className,
}: {
  visible: boolean;
  onClick: () => void;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className={cn(
        "absolute top-3 left-1/2 -translate-x-1/2 z-10",
        "flex items-center gap-1 px-2.5 py-1 rounded-full",
        "bg-background/80 border border-border backdrop-blur-sm shadow-sm",
        "text-[9px] font-mono text-muted-foreground hover:text-primary transition-colors",
        className
      )}
    >
      <ArrowUp size={9} />
      top
    </button>
  );
}

// ── Scroll-to-bottom button ───────────────────────────────────────────────────

export function ScrollToBottomButton({
  visible,
  onClick,
  className,
}: {
  visible: boolean;
  onClick: () => void;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className={cn(
        "absolute bottom-3 right-3 z-10",
        "w-7 h-7 rounded-full",
        "bg-primary/20 border border-primary/30 text-primary",
        "flex items-center justify-center",
        "hover:bg-primary/30 transition-all shadow-lg",
        className
      )}
    >
      <ChevronDown size={13} />
    </button>
  );
}

// ── End-of-feed marker ────────────────────────────────────────────────────────
// Rendered after the last message to close the thread visually.

export function EndOfFeed({
  messageCount,
  lastUpdated,
  className,
}: {
  messageCount: number;
  lastUpdated?: Date;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1 py-5 select-none pointer-events-none", className)}>
      <div className="flex items-center gap-3 w-full max-w-[200px]">
        <div className="flex-1 h-px bg-border/40" />
        <span className="text-[8px] font-mono text-muted-foreground/35 uppercase tracking-widest whitespace-nowrap">
          end of thread
        </span>
        <div className="flex-1 h-px bg-border/40" />
      </div>
      <div className="flex items-center gap-2 text-[8px] font-mono text-muted-foreground/25">
        <span>{messageCount} message{messageCount !== 1 ? "s" : ""}</span>
        {lastUpdated && (
          <>
            <span>·</span>
            <span>{lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </>
        )}
      </div>
    </div>
  );
}
