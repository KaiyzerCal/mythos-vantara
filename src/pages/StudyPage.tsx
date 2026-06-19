// ============================================================
// VANTARA.EXE — StudyPage
// Spaced repetition study / review mode
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, CheckCircle2, Loader2, ChevronRight, RefreshCw, Brain } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard, ProgressBar } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface MavisNote {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[] | null;
  properties: Record<string, unknown> | null;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  review_interval_days: number;
  created_at: string;
}

interface SessionStats {
  reviewed: number;
  easy: number;
  hard: number;
}

// ─── Rating config ──────────────────────────────────────────
const RATINGS: { label: string; value: number; color: string; bg: string }[] = [
  { label: "1 Again", value: 1, color: "text-red-300", bg: "border-red-700/50 bg-red-900/30 hover:bg-red-900/50" },
  { label: "2 Hard", value: 2, color: "text-orange-300", bg: "border-orange-700/50 bg-orange-900/30 hover:bg-orange-900/50" },
  { label: "3 Good", value: 3, color: "text-yellow-300", bg: "border-yellow-700/50 bg-yellow-900/30 hover:bg-yellow-900/50" },
  { label: "4 Easy", value: 4, color: "text-green-300", bg: "border-green-700/50 bg-green-900/30 hover:bg-green-900/50" },
  { label: "5 Perfect", value: 5, color: "text-cyan-300", bg: "border-cyan-700/50 bg-cyan-900/30 hover:bg-cyan-900/50" },
];

// ─── SR interval calculation ────────────────────────────────
function calcNextInterval(rating: number, currentInterval: number): number {
  const interval = Math.max(currentInterval, 1);
  switch (rating) {
    case 1: return 1;
    case 2: return Math.max(1, Math.min(interval, 90));
    case 3: return Math.max(3, Math.min(Math.round(interval * 1.5), 90));
    case 4: return Math.max(7, Math.min(Math.round(interval * 2.5), 180));
    case 5: return Math.max(14, Math.min(Math.round(interval * 3.5), 365));
    default: return interval;
  }
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function tomorrowIso(): string {
  return addDays(1);
}

// Properties to hide in card view
const HIDDEN_PROPS = new Set(["skip_sr", "chunk_index", "source_doc", "embedding"]);

// ─── StudyPage ──────────────────────────────────────────────
export function StudyPage() {
  const { user } = useAuth();

  const [dueNotes, setDueNotes] = useState<MavisNote[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats>({ reviewed: 0, easy: 0, hard: 0 });
  const [sessionComplete, setSessionComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [nextDueCount, setNextDueCount] = useState(0);
  const [expandContent, setExpandContent] = useState(false);

  // ─── Fetch due notes ────────────────────────────────────────
  const fetchDueNotes = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("mavis_notes")
      .select("*")
      .eq("user_id", user.id)
      .or(`next_review_at.is.null,next_review_at.lte.${now}`)
      .order("next_review_at", { ascending: true, nullsFirst: true })
      .limit(20);

    if (error) {
      toast.error("Failed to load study cards");
    } else {
      // Filter out skip_sr=true
      const filtered = (data as MavisNote[]).filter((n) => {
        const props = n.properties as Record<string, unknown> | null;
        return !props || props["skip_sr"] !== "true";
      });
      setDueNotes(filtered);
    }
    setLoading(false);
  }, [user]);

  // ─── Fetch tomorrow's count ────────────────────────────────
  const fetchNextDueCount = useCallback(async () => {
    if (!user) return;
    const tomorrow = tomorrowIso();
    const { count } = await supabase
      .from("mavis_notes")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .lte("next_review_at", tomorrow);
    setNextDueCount(count ?? 0);
  }, [user]);

  useEffect(() => {
    fetchDueNotes();
  }, [fetchDueNotes]);

  useEffect(() => {
    if (sessionComplete) fetchNextDueCount();
  }, [sessionComplete, fetchNextDueCount]);

  // ─── Load more (manual study, no filter) ───────────────────
  async function handleLoadMore() {
    if (!user) return;
    setLoading(true);
    setSessionComplete(false);
    setCurrentIndex(0);
    setShowAnswer(false);
    setSessionStats({ reviewed: 0, easy: 0, hard: 0 });

    const { data } = await supabase
      .from("mavis_notes")
      .select("*")
      .eq("user_id", user.id)
      .order("next_review_at", { ascending: true, nullsFirst: true })
      .limit(20);

    const filtered = (data as MavisNote[] || []).filter((n) => {
      const props = n.properties as Record<string, unknown> | null;
      return !props || props["skip_sr"] !== "true";
    });
    setDueNotes(filtered);
    setLoading(false);
  }

  // ─── Rate card ─────────────────────────────────────────────
  async function handleRating(rating: number) {
    if (!user || ratingLoading) return;
    const note = dueNotes[currentIndex];
    if (!note) return;

    setRatingLoading(true);
    const newInterval = calcNextInterval(rating, note.review_interval_days || 1);
    const nextReview = addDays(newInterval);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("mavis_notes")
      .update({
        last_reviewed_at: now,
        next_review_at: nextReview,
        review_interval_days: newInterval,
      })
      .eq("id", note.id);

    if (error) {
      toast.error("Failed to save rating");
      setRatingLoading(false);
      return;
    }

    // Update session stats
    setSessionStats((prev) => ({
      reviewed: prev.reviewed + 1,
      easy: rating >= 4 ? prev.easy + 1 : prev.easy,
      hard: rating <= 2 ? prev.hard + 1 : prev.hard,
    }));

    // Advance
    const nextIndex = currentIndex + 1;
    if (nextIndex >= dueNotes.length) {
      setSessionComplete(true);
    } else {
      setCurrentIndex(nextIndex);
      setShowAnswer(false);
      setExpandContent(false);
    }
    setRatingLoading(false);
  }

  // ─── End session ───────────────────────────────────────────
  function handleEndSession() {
    setSessionComplete(true);
  }

  // ─── Computed ──────────────────────────────────────────────
  const note = dueNotes[currentIndex];
  const easyPct = sessionStats.reviewed > 0 ? Math.round((sessionStats.easy / sessionStats.reviewed) * 100) : 0;
  const hardPct = sessionStats.reviewed > 0 ? Math.round((sessionStats.hard / sessionStats.reviewed) * 100) : 0;

  const visibleProps = note?.properties
    ? Object.entries(note.properties).filter(([k]) => !HIDDEN_PROPS.has(k))
    : [];

  const contentPreview = note?.content
    ? expandContent
      ? note.content
      : note.content.slice(0, 300) + (note.content.length > 300 ? "..." : "")
    : "";

  // ─── Session Complete Screen ────────────────────────────────
  if (!loading && (sessionComplete || dueNotes.length === 0)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Study Mode"
          subtitle={`${dueNotes.length} cards due`}
          icon={<Brain size={18} />}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center justify-center py-12"
        >
          <HudCard className="max-w-md w-full text-center" glowColor="gold">
            <CheckCircle2 size={48} className="text-green-400 mx-auto mb-4" />
            <h2 className="font-display text-xl font-bold text-primary mb-1">Session Complete!</h2>
            <p className="text-xs font-mono text-muted-foreground mb-6">
              {dueNotes.length === 0 ? "No cards were due for review." : "You've reviewed all due cards."}
            </p>

            {sessionStats.reviewed > 0 && (
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="p-2 rounded bg-muted/30 border border-border">
                  <p className="text-lg font-display font-bold text-foreground">{sessionStats.reviewed}</p>
                  <p className="text-xs font-mono text-muted-foreground uppercase">Reviewed</p>
                </div>
                <div className="p-2 rounded bg-muted/30 border border-border">
                  <p className="text-lg font-display font-bold text-green-400">{easyPct}%</p>
                  <p className="text-xs font-mono text-muted-foreground uppercase">Easy</p>
                </div>
                <div className="p-2 rounded bg-muted/30 border border-border">
                  <p className="text-lg font-display font-bold text-red-400">{hardPct}%</p>
                  <p className="text-xs font-mono text-muted-foreground uppercase">Hard</p>
                </div>
              </div>
            )}

            {nextDueCount > 0 && (
              <p className="text-xs font-mono text-muted-foreground mb-4">
                <span className="text-primary font-bold">{nextDueCount}</span> card{nextDueCount !== 1 ? "s" : ""} due by tomorrow
              </p>
            )}

            <button
              onClick={handleLoadMore}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors mx-auto"
            >
              <RefreshCw size={12} /> Load More Cards
            </button>
          </HudCard>
        </motion.div>
      </div>
    );
  }

  // ─── Loading ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Study Mode"
          subtitle="Loading cards..."
          icon={<Brain size={18} />}
        />
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-primary" size={28} />
        </div>
      </div>
    );
  }

  // ─── Study UI ──────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Study Mode"
        subtitle={`${dueNotes.length} card${dueNotes.length !== 1 ? "s" : ""} due`}
        icon={<Brain size={18} />}
        actions={
          <button
            onClick={handleEndSession}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-border text-muted-foreground rounded hover:text-foreground hover:border-border/80 transition-colors"
          >
            End Session
          </button>
        }
      />

      {/* ── Progress bar ───────────────────────────────────────── */}
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-xs font-mono text-muted-foreground">Progress</span>
          <span className="text-xs font-mono text-primary">
            {currentIndex + 1} / {dueNotes.length}
          </span>
        </div>
        <ProgressBar value={currentIndex} max={dueNotes.length} colorClass="bg-primary" height="sm" />
      </div>

      {/* ── Flashcard ─────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <HudCard glowColor="gold" className="min-h-56">
            {/* Tags */}
            {note?.tags && note.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs font-mono px-1.5 py-0.5 rounded border bg-muted/30 border-border text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Title */}
            <h2 className="font-display text-lg font-bold text-foreground leading-snug mb-3">
              {note?.title}
            </h2>

            {/* Show Answer */}
            {!showAnswer ? (
              <div className="flex justify-center mt-6">
                <button
                  onClick={() => setShowAnswer(true)}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-mono bg-primary/10 border border-primary/40 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                >
                  <BookOpen size={14} /> Show Answer
                </button>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Content */}
                <div className="mb-4 p-3 rounded bg-muted/20 border border-border/40">
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {contentPreview}
                  </p>
                  {note?.content && note.content.length > 300 && (
                    <button
                      onClick={() => setExpandContent((v) => !v)}
                      className="mt-1 flex items-center gap-1 text-xs font-mono text-primary hover:underline"
                    >
                      {expandContent ? "show less" : "...read more"}
                      <ChevronRight size={10} className={expandContent ? "rotate-90" : ""} />
                    </button>
                  )}
                </div>

                {/* Properties */}
                {visibleProps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {visibleProps.map(([k, v]) => (
                      <span
                        key={k}
                        className="text-xs font-mono px-1.5 py-0.5 rounded border bg-muted/30 border-border text-muted-foreground"
                      >
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Rating Buttons */}
                <div>
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">Rate your recall</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {RATINGS.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => handleRating(r.value)}
                        disabled={ratingLoading}
                        className={`flex-1 min-w-0 px-2 py-2 text-xs font-mono rounded border transition-colors disabled:opacity-50 ${r.bg} ${r.color}`}
                      >
                        {ratingLoading ? (
                          <Loader2 size={11} className="animate-spin mx-auto" />
                        ) : (
                          r.label
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </HudCard>
        </motion.div>
      </AnimatePresence>

      {/* ── Session Stats Row ─────────────────────────────────── */}
      {sessionStats.reviewed > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-3 gap-3"
        >
          <HudCard>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-0.5">Reviewed</p>
            <p className="text-xl font-display font-bold text-foreground">{sessionStats.reviewed}</p>
          </HudCard>
          <HudCard>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-0.5">Easy</p>
            <p className="text-xl font-display font-bold text-green-400">{easyPct}%</p>
          </HudCard>
          <HudCard>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-0.5">Hard</p>
            <p className="text-xl font-display font-bold text-red-400">{hardPct}%</p>
          </HudCard>
        </motion.div>
      )}
    </div>
  );
}
