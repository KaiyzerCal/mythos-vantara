// Name anything, learn it to mastery.
//
// The other half of /study. Review drills notes the operator already wrote;
// this takes a subject they have never written about — a skill, a book, a
// speech, a documentary — and builds the whole ascent: eight competency tiers,
// a ~90 second lesson per tier, a quiz that explains every answer, a mentor to
// argue with, and a level that only moves on demonstrated competency.
//
// Courses are read straight from study_courses rather than through the edge
// function: RLS already scopes the table to the operator, so a list endpoint
// would be a second round trip enforcing a rule the database enforces anyway.
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Loader2, ChevronRight, CheckCircle2, XCircle, Trash2,
  MessageSquare, Send, BookOpen, Layers, Phone, Volume2, Square,
} from "lucide-react";
import { VoiceChatOverlay } from "@/components/VoiceChatOverlay";
import { useElevenLabsTts } from "@/hooks/useElevenLabsTts";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { HudCard, ProgressBar } from "@/components/SharedUI";
import { toast } from "sonner";

const MAX_LEVEL = 8;
/**
 * Mirrors the same formula in mavis-study-course. The server is authoritative —
 * it decides the level and XP — but the progress bar needs the goal to draw
 * itself without a round trip. A drift test keeps the two honest.
 */
export const levelGoal = (level: number) => 300 + (level - 1) * 250;

interface Tier { tier: string; focus: string; }
interface Question {
  question: string; options: string[]; correctIndex: number; explanation: string;
}
interface Lesson { title: string; keyIdea: string; body: string; quiz: Question[]; }

interface CourseRow {
  id: string;
  subject: string;
  kind: string;
  title: string;
  attribution: string;
  premise: string;
  tiers: Tier[];
  level: number;
  xp: number;
  covered: string[];
  lesson: Lesson | null;
  grounded_in: string;
  last_opened_at: string;
}

interface ChatTurn { role: "user" | "assistant"; content: string; }

export function LearnMode() {
  const { user } = useAuth();

  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [building, setBuilding] = useState(false);
  const [active, setActive] = useState<CourseRow | null>(null);

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [qIndex, setQIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [reward, setReward] = useState<{ gained: number; leveled: boolean } | null>(null);

  // Voice, both directions.
  //
  // The overlay is driven in sendMessage mode rather than persona mode. In
  // persona mode it calls the model itself from a system prompt, which would
  // bypass ask_mentor — and with it the search over the operator's own
  // material that runs on every mentor turn. Routing through sendMessage keeps
  // the spoken mentor and the typed mentor the same mentor.
  const { speak, stop: stopSpeaking, isSpeaking, isLoading: voiceLoading } = useElevenLabsTts();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [lastReply, setLastReply] = useState("");

  const [mentorOpen, setMentorOpen] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);

  const loadCourses = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("study_courses")
      .select("*")
      .eq("user_id", user.id)
      .order("last_opened_at", { ascending: false });
    if (error) toast.error("Could not load courses");
    else setCourses((data ?? []) as CourseRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  async function buildCourse() {
    const s = subject.trim();
    if (s.length < 2 || building) return;
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-study-course", {
        body: { action: "build_course", subject: s },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setSubject("");
      await loadCourses();
      toast.success(
        data?.grounded_in === "own_material"
          ? "Built from your own material"
          : "Course composed",
      );
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not build that course");
    } finally {
      setBuilding(false);
    }
  }

  function openCourse(c: CourseRow) {
    setActive(c);
    setLesson(c.lesson ?? null);
    setQIndex(0); setPicked(null); setCorrect(0); setReward(null);
    setChat([]); setMentorOpen(false);
  }

  async function nextLesson(courseId: string) {
    setLessonLoading(true);
    setReward(null);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-study-course", {
        body: { action: "build_lesson", id: courseId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setLesson(data.lesson as Lesson);
      setQIndex(0); setPicked(null); setCorrect(0);
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not build the lesson");
    } finally {
      setLessonLoading(false);
    }
  }

  function pick(i: number) {
    if (picked !== null || !lesson) return;
    const q = lesson.quiz[qIndex];
    if (!q) return;
    setPicked(i);
    if (i === q.correctIndex) setCorrect((c) => c + 1);
  }

  async function advance() {
    if (!lesson || !active) return;
    const last = qIndex + 1 >= lesson.quiz.length;
    if (!last) { setQIndex((i) => i + 1); setPicked(null); return; }

    // Level and XP are settled server-side: the client knows what was answered,
    // never what that is worth.
    try {
      const { data, error } = await supabase.functions.invoke("mavis-study-course", {
        body: { action: "answer", id: active.id, correct, total: lesson.quiz.length },
      });
      if (error) throw new Error(error.message);
      setReward({ gained: Number(data?.gained ?? 0), leveled: !!data?.leveled });
      setActive((prev) => prev ? { ...prev, level: Number(data?.level ?? prev.level), xp: Number(data?.xp ?? prev.xp) } : prev);
      setLesson(null);
      if (data?.leveled) toast.success(`Level ${data.level} — the material gets harder now`);
      loadCourses();
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not save progress");
    }
  }

  async function sendToMentor() {
    const q = ask.trim();
    if (!q || asking || !active) return;
    const next: ChatTurn[] = [...chat, { role: "user", content: q }];
    setChat(next); setAsk(""); setAsking(true);
    try {
      const { data, error } = await supabase.functions.invoke("mavis-study-course", {
        body: { action: "ask_mentor", id: active.id, messages: next },
      });
      if (error) throw new Error(error.message);
      const reply = String(data?.reply ?? "");
      setChat([...next, { role: "assistant", content: reply }]);
      setLastReply(reply);
    } catch (err) {
      toast.error((err as Error)?.message ?? "The mentor did not answer");
      setChat(chat);
    } finally {
      setAsking(false);
    }
  }

  /**
   * The overlay hands us transcribed speech and reads back whatever lands in
   * lastReply. Same edge function, same grounding, same conversation history
   * as the typed panel — only the input and output devices differ.
   */
  const askByVoice = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || !active) return;
    setChat((prev) => {
      const next: ChatTurn[] = [...prev, { role: "user", content: q }];
      (async () => {
        setAsking(true);
        try {
          const { data, error } = await supabase.functions.invoke("mavis-study-course", {
            body: { action: "ask_mentor", id: active.id, messages: next },
          });
          if (error) throw new Error(error.message);
          const reply = String(data?.reply ?? "");
          setChat([...next, { role: "assistant", content: reply }]);
          setLastReply(reply);
        } catch (err) {
          toast.error((err as Error)?.message ?? "The mentor did not answer");
        } finally {
          setAsking(false);
        }
      })();
      return next;
    });
  }, [active]);

  // Stop any narration when the course changes or the component goes away —
  // a lesson still being read aloud after you navigate is its own small bug.
  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  async function removeCourse(id: string) {
    const { error } = await supabase.from("study_courses").delete().eq("id", id);
    if (error) return toast.error("Could not remove that course");
    if (active?.id === id) setActive(null);
    loadCourses();
  }

  // ── Shelf ───────────────────────────────────────────────────────────────
  if (!active) {
    return (
      <div className="space-y-4">
        <HudCard glowColor="gold">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
            Learn anything to mastery
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            Name a skill, book, essay, speech, film, documentary or textbook. If you have written
            about it anywhere in the app, the course is built from your own material.
          </p>
          <div className="flex gap-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") buildCourse(); }}
              placeholder="Name your material..."
              className="flex-1 bg-muted/30 border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
            />
            <button
              onClick={buildCourse}
              disabled={building || subject.trim().length < 2}
              className="flex items-center gap-2 px-4 py-2 text-sm font-mono bg-primary/10 border border-primary/40 text-primary rounded hover:bg-primary/20 transition-colors disabled:opacity-40"
            >
              {building ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {building ? "Composing..." : "Compose"}
            </button>
          </div>
        </HudCard>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" size={24} /></div>
        ) : courses.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground text-center py-8">
            No courses yet. Name something above.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {courses.map((c) => (
              <HudCard key={c.id} className="group">
                <button onClick={() => openCourse(c)} className="text-left w-full">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display text-sm font-bold text-foreground truncate">{c.title || c.subject}</p>
                      <p className="text-xs font-mono text-muted-foreground truncate">
                        {c.kind}{c.attribution ? ` · ${c.attribution}` : ""}
                      </p>
                    </div>
                    <span className="text-xs font-mono text-primary shrink-0">L{c.level}</span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={c.xp} max={levelGoal(c.level)} colorClass="bg-primary" height="sm" />
                  </div>
                  {c.grounded_in === "own_material" && (
                    <p className="mt-1.5 text-xs font-mono text-cyan-400">from your own material</p>
                  )}
                </button>
                <button
                  onClick={() => removeCourse(c.id)}
                  className="mt-2 flex items-center gap-1 text-xs font-mono text-muted-foreground/50 hover:text-destructive transition-colors"
                >
                  <Trash2 size={10} /> remove
                </button>
              </HudCard>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── A course ────────────────────────────────────────────────────────────
  const tiers = active.tiers ?? [];
  const tier = tiers[Math.min(active.level - 1, tiers.length - 1)];
  const q = lesson?.quiz[qIndex];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setActive(null)}
          className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          ← all courses
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { stopSpeaking(); setVoiceOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-cyan-900/40 text-cyan-400 rounded hover:border-cyan-400/40 transition-colors"
            title={`Call the mentor on ${active.title || active.subject}`}
          >
            <Phone size={11} /> Call
          </button>
          <button
            onClick={() => setMentorOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-cyan-900/40 text-cyan-400 rounded hover:border-cyan-400/40 transition-colors"
          >
            <MessageSquare size={11} /> Mentor
          </button>
        </div>
      </div>

      <HudCard glowColor="gold">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
          {tier?.tier ?? "Novice"} · level {active.level} of {MAX_LEVEL}
        </p>
        <h2 className="font-display text-lg font-bold text-foreground">{active.title || active.subject}</h2>
        {active.premise && <p className="text-sm text-muted-foreground mt-1">{active.premise}</p>}
        <div className="mt-3">
          <div className="flex justify-between mb-1">
            <span className="text-xs font-mono text-muted-foreground">{tier?.focus ?? ""}</span>
            <span className="text-xs font-mono text-primary">{active.xp} / {levelGoal(active.level)} XP</span>
          </div>
          <ProgressBar value={active.xp} max={levelGoal(active.level)} colorClass="bg-primary" height="sm" />
        </div>
        {active.grounded_in === "own_material" ? (
          <p className="mt-2 text-xs font-mono text-cyan-400">Built from your own material.</p>
        ) : (
          <p className="mt-2 text-xs font-mono text-muted-foreground">
            Built from general knowledge — you have not written about this in the app.
          </p>
        )}
      </HudCard>

      {/* The ladder, so the whole ascent is visible rather than implied */}
      <HudCard>
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
          <Layers size={11} className="inline mr-1 -mt-0.5" /> The ascent
        </p>
        <div className="space-y-1">
          {tiers.map((t, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs ${
                i + 1 === active.level
                  ? "bg-primary/10 border border-primary/30"
                  : i + 1 < active.level
                    ? "text-muted-foreground/60"
                    : "text-muted-foreground/40"
              }`}
            >
              <span className="font-mono shrink-0">{i + 1 < active.level ? "✓" : i + 1}</span>
              <div className="min-w-0">
                <p className={i + 1 === active.level ? "text-primary font-mono" : "font-mono"}>{t.tier}</p>
                <p className="opacity-70">{t.focus}</p>
              </div>
            </div>
          ))}
        </div>
      </HudCard>

      {/* Lesson + quiz */}
      <AnimatePresence mode="wait">
        {!lesson ? (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <HudCard className="text-center">
              {reward && (
                <p className="text-sm font-mono text-primary mb-3">
                  +{reward.gained} XP{reward.leveled ? " — level up" : ""}
                </p>
              )}
              <button
                onClick={() => nextLesson(active.id)}
                disabled={lessonLoading}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-mono bg-primary/10 border border-primary/40 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50 mx-auto"
              >
                {lessonLoading ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
                {lessonLoading ? "Composing the lesson..." : "Next lesson"}
              </button>
            </HudCard>
          </motion.div>
        ) : (
          <motion.div key="lesson" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <HudCard glowColor="gold">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-display text-base font-bold text-foreground">{lesson.title}</h3>
                {/* A ninety-second lesson is the part you would rather listen to
                    than read — hands busy, screen away. */}
                <button
                  onClick={() =>
                    isSpeaking
                      ? stopSpeaking()
                      : speak(`${lesson.title}. ${lesson.keyIdea} ${lesson.body}`)
                  }
                  disabled={voiceLoading}
                  className="shrink-0 flex items-center gap-1.5 px-2 py-1 text-xs font-mono border border-cyan-900/40 text-cyan-400 rounded hover:border-cyan-400/40 transition-colors disabled:opacity-40"
                  title={isSpeaking ? "Stop" : "Listen to this lesson"}
                >
                  {voiceLoading
                    ? <Loader2 size={11} className="animate-spin" />
                    : isSpeaking ? <Square size={11} /> : <Volume2 size={11} />}
                  {isSpeaking ? "Stop" : "Listen"}
                </button>
              </div>
              {lesson.keyIdea && (
                <p className="text-xs font-mono text-primary mb-3">{lesson.keyIdea}</p>
              )}
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap mb-4">{lesson.body}</p>

              {q && (
                <div className="pt-3 border-t border-border/40">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
                    Question {qIndex + 1} of {lesson.quiz.length}
                  </p>
                  <p className="text-sm text-foreground/90 mb-3">{q.question}</p>
                  <div className="space-y-1.5">
                    {q.options.map((opt, i) => {
                      const answered = picked !== null;
                      const isCorrect = i === q.correctIndex;
                      const isPicked = picked === i;
                      const tone = !answered
                        ? "border-border bg-muted/20 text-foreground/90 hover:border-primary/40"
                        : isCorrect
                          ? "border-green-700/50 bg-green-900/20 text-green-300"
                          : isPicked
                            ? "border-orange-700/50 bg-orange-900/20 text-orange-300"
                            : "border-border/40 bg-muted/10 text-muted-foreground";
                      return (
                        <button
                          key={i}
                          onClick={() => pick(i)}
                          disabled={answered}
                          className={`w-full text-left px-3 py-2 text-sm rounded border transition-colors disabled:cursor-default ${tone}`}
                        >
                          <span className="font-mono text-xs mr-2 opacity-60">{"ABCD"[i]}</span>
                          {opt}
                          {answered && isCorrect && <CheckCircle2 size={12} className="inline ml-2 -mt-0.5" />}
                          {answered && isPicked && !isCorrect && <XCircle size={12} className="inline ml-2 -mt-0.5" />}
                        </button>
                      );
                    })}
                  </div>

                  {picked !== null && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3">
                      <div className="p-3 rounded bg-muted/20 border border-border/40">
                        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">Why</p>
                        <p className="text-sm text-foreground/90 leading-relaxed">{q.explanation}</p>
                      </div>
                      <button
                        onClick={advance}
                        className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-mono bg-primary/10 border border-primary/40 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                      >
                        {qIndex + 1 >= lesson.quiz.length ? "Finish lesson" : "Next question"}
                        <ChevronRight size={12} />
                      </button>
                    </motion.div>
                  )}
                </div>
              )}
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice call with the mentor */}
      <AnimatePresence>
        {voiceOpen && active && (
          <VoiceChatOverlay
            onClose={() => setVoiceOpen(false)}
            sendMessage={askByVoice}
            lastBotMessage={lastReply}
            isLoading={asking}
            externalAudio={false}
          />
        )}
      </AnimatePresence>

      {/* Mentor */}
      {mentorOpen && (
        <HudCard>
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">
            Argue with the mentor
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto mb-2">
            {chat.length === 0 && (
              <p className="text-xs font-mono text-muted-foreground">
                Ask anything about {active.title || active.subject}.
              </p>
            )}
            {chat.map((m, i) => (
              <div
                key={i}
                className={`text-sm p-2 rounded ${
                  m.role === "user"
                    ? "bg-primary/10 border border-primary/20 text-foreground/90"
                    : "bg-muted/20 border border-border/40 text-foreground/90"
                }`}
              >
                {m.content}
              </div>
            ))}
            {asking && <Loader2 size={14} className="animate-spin text-primary" />}
          </div>
          <div className="flex gap-2">
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendToMentor(); }}
              placeholder="Ask, or push back..."
              className="flex-1 bg-muted/30 border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
            />
            <button
              onClick={sendToMentor}
              disabled={asking || !ask.trim()}
              className="px-3 py-2 bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-30 transition-colors"
            >
              <Send size={14} />
            </button>
          </div>
        </HudCard>
      )}
    </div>
  );
}
