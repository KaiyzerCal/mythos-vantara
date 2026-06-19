// ============================================================
// VANTARA.EXE — MeetingNotesPage
// AI-structured meeting capture with transcript processing
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Video, Plus, X, Loader2, ChevronDown, ChevronUp,
  Check, Calendar, Users, FileText, Zap,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { useAppData } from "@/contexts/AppDataContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
interface ActionItem {
  owner: string;
  task: string;
  due_date: string;
}

interface MeetingNote {
  id: string;
  user_id: string;
  title: string;
  meeting_date: string;
  attendees: string[] | null;
  decisions: string[] | null;
  action_items: ActionItem[] | null;
  key_points: string[] | null;
  summary: string | null;
  raw_transcript: string | null;
  created_at: string;
}

interface FormState {
  title: string;
  meeting_date: string;
  transcript: string;
}

// ─── Helpers ────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── MeetingNotesPage ────────────────────────────────────────
export function MeetingNotesPage() {
  const { user, session } = useAuth();
  const { lastActionTs } = useAppData();

  const [meetings, setMeetings] = useState<MeetingNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState<FormState>({
    title: "",
    meeting_date: todayStr(),
    transcript: "",
  });
  const [processing, setProcessing] = useState(false);
  const [selected, setSelected] = useState<MeetingNote | null>(null);

  // ─── Load meetings ──────────────────────────────────────────
  const loadMeetings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("meeting_notes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      toast.error("Failed to load meetings");
    } else {
      setMeetings((data as MeetingNote[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);
  useEffect(() => { if (lastActionTs) loadMeetings(); }, [lastActionTs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Process transcript ─────────────────────────────────────
  async function processTranscript() {
    if (!session) return;
    if (!formState.title.trim()) {
      toast.error("Meeting title is required");
      return;
    }
    if (!formState.transcript.trim()) {
      toast.error("Transcript or notes are required");
      return;
    }
    setProcessing(true);
    const toastId = toast.loading("Processing transcript with MAVIS...");

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-meeting-notes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            transcript: formState.transcript,
            title: formState.title,
            meeting_date: formState.meeting_date,
            save_to_db: true,
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      toast.success("Meeting notes saved", { id: toastId });
      setFormState({ title: "", meeting_date: todayStr(), transcript: "" });
      setShowForm(false);
      await loadMeetings();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Processing failed";
      toast.error(msg, { id: toastId });
    } finally {
      setProcessing(false);
    }
  }

  // ─── Toggle selected meeting ────────────────────────────────
  function toggleSelected(meeting: MeetingNote) {
    setSelected((prev) => (prev?.id === meeting.id ? null : meeting));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meeting Notes"
        subtitle="AI-structured meeting capture"
        icon={<Video size={18} />}
        actions={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
          >
            <Plus size={12} /> New Meeting
          </button>
        }
      />

      {/* ── New Meeting Form ──────────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <HudCard glowColor="gold">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-mono text-primary uppercase tracking-widest">
                  New Meeting Notes
                </p>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                      Meeting Title *
                    </label>
                    <input
                      type="text"
                      value={formState.title}
                      onChange={(e) => setFormState((f) => ({ ...f, title: e.target.value }))}
                      placeholder="e.g. Q2 Planning Sync"
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                      Meeting Date
                    </label>
                    <input
                      type="date"
                      value={formState.meeting_date}
                      onChange={(e) => setFormState((f) => ({ ...f, meeting_date: e.target.value }))}
                      className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-mono text-muted-foreground block mb-0.5">
                    Transcript / Raw Notes *
                  </label>
                  <textarea
                    value={formState.transcript}
                    onChange={(e) => setFormState((f) => ({ ...f, transcript: e.target.value }))}
                    placeholder="Paste transcript, call notes, or bullet points..."
                    rows={8}
                    className="w-full bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40 resize-y"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={processTranscript}
                    disabled={processing}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                  >
                    {processing ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Zap size={11} />
                    )}
                    {processing ? "Processing..." : "Process with MAVIS"}
                  </button>
                </div>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Meeting List ──────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-primary" size={22} />
        </div>
      ) : meetings.length === 0 ? (
        <HudCard className="text-center py-12">
          <Video size={32} className="text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-mono text-muted-foreground">No meeting notes yet.</p>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            Click "+ New Meeting" to capture your first meeting.
          </p>
        </HudCard>
      ) : (
        <div className="space-y-3">
          {meetings.map((meeting) => {
            const isSelected = selected?.id === meeting.id;
            return (
              <motion.div
                key={meeting.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Summary card (always visible) */}
                <HudCard
                  glowColor="none"
                  onClick={() => toggleSelected(meeting)}
                  className="cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-mono font-bold text-foreground">
                          {meeting.title}
                        </h3>
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded border border-primary/20 bg-primary/10 text-primary shrink-0">
                          {fmtDate(meeting.meeting_date)}
                        </span>
                      </div>
                      {meeting.summary && (
                        <p className="text-xs font-mono text-muted-foreground line-clamp-2 leading-relaxed">
                          {meeting.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5">
                        {meeting.attendees && meeting.attendees.length > 0 && (
                          <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                            <Users size={9} /> {meeting.attendees.length} attendees
                          </span>
                        )}
                        {meeting.action_items && meeting.action_items.length > 0 && (
                          <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                            <Check size={9} /> {meeting.action_items.length} actions
                          </span>
                        )}
                        {meeting.key_points && meeting.key_points.length > 0 && (
                          <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                            <FileText size={9} /> {meeting.key_points.length} key points
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-muted-foreground mt-0.5">
                      {isSelected ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>
                </HudCard>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-1 ml-0 space-y-3 pl-0">
                        {/* Attendees */}
                        {meeting.attendees && meeting.attendees.length > 0 && (
                          <HudCard className="bg-muted/10">
                            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-2 flex items-center gap-1">
                              <Users size={9} /> Attendees
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {meeting.attendees.map((a, i) => (
                                <span
                                  key={i}
                                  className="text-xs font-mono px-2 py-0.5 rounded border border-border bg-muted/30 text-foreground"
                                >
                                  {a}
                                </span>
                              ))}
                            </div>
                          </HudCard>
                        )}

                        {/* Key Points */}
                        {meeting.key_points && meeting.key_points.length > 0 && (
                          <HudCard className="bg-muted/10">
                            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-2 flex items-center gap-1">
                              <FileText size={9} /> Key Points
                            </p>
                            <ul className="space-y-1">
                              {meeting.key_points.map((pt, i) => (
                                <li key={i} className="flex gap-2 text-xs font-mono text-foreground/90">
                                  <span className="text-primary shrink-0 mt-0.5">›</span>
                                  <span>{pt}</span>
                                </li>
                              ))}
                            </ul>
                          </HudCard>
                        )}

                        {/* Decisions */}
                        {meeting.decisions && meeting.decisions.length > 0 && (
                          <HudCard className="bg-muted/10">
                            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-2 flex items-center gap-1">
                              <Check size={9} /> Decisions
                            </p>
                            <ul className="space-y-1">
                              {meeting.decisions.map((d, i) => (
                                <li key={i} className="flex gap-2 text-xs font-mono text-foreground/90">
                                  <Check size={11} className="text-green-400 shrink-0 mt-0.5" />
                                  <span>{d}</span>
                                </li>
                              ))}
                            </ul>
                          </HudCard>
                        )}

                        {/* Action Items */}
                        {meeting.action_items && meeting.action_items.length > 0 && (
                          <HudCard className="bg-muted/10">
                            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-2 flex items-center gap-1">
                              <Zap size={9} /> Action Items
                            </p>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs font-mono">
                                <thead>
                                  <tr className="border-b border-border/40">
                                    <th className="text-left text-xs text-muted-foreground pb-1 pr-3">Owner</th>
                                    <th className="text-left text-xs text-muted-foreground pb-1 pr-3">Task</th>
                                    <th className="text-left text-xs text-muted-foreground pb-1">Due</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {meeting.action_items.map((item, i) => (
                                    <tr key={i} className="border-b border-border/20 last:border-0">
                                      <td className="py-1.5 pr-3 text-primary shrink-0 whitespace-nowrap">
                                        {item.owner}
                                      </td>
                                      <td className="py-1.5 pr-3 text-foreground/90">{item.task}</td>
                                      <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                                        {item.due_date ? fmtDate(item.due_date) : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </HudCard>
                        )}

                        {/* Calendar info row */}
                        <div className="flex items-center gap-1.5 pl-1">
                          <Calendar size={10} className="text-muted-foreground" />
                          <span className="text-xs font-mono text-muted-foreground">
                            Captured {new Date(meeting.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
