// ============================================================
// VANTARA.EXE — SchedulerPage
// Social post scheduling and queue management
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Plus, Trash2, CheckCircle2, Clock, Send, Loader2, X, MessageSquare } from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────
type PostStatus = "queued" | "scheduled" | "posted" | "failed" | "requires_confirmation";
type Platform = "twitter" | "linkedin" | "instagram" | "youtube" | "other";
type ActiveTab = "queue" | "calendar" | "posted";

interface SocialPost {
  id: string;
  user_id: string;
  content: string;
  platform: string;
  status: PostStatus;
  scheduled_at: string | null;
  created_at: string;
}

interface CreateForm {
  content: string;
  platform: Platform;
  scheduled_at: string;
}

// ─── Helpers ────────────────────────────────────────────────
const PLATFORM_COLORS: Record<string, string> = {
  twitter: "bg-sky-900/50 text-sky-300 border-sky-700",
  linkedin: "bg-blue-900/50 text-blue-300 border-blue-700",
  instagram: "bg-pink-900/50 text-pink-300 border-pink-700",
  youtube: "bg-red-900/50 text-red-300 border-red-700",
  other: "bg-zinc-800/50 text-zinc-300 border-zinc-600",
};

const PLATFORMS: Platform[] = ["twitter", "linkedin", "instagram", "youtube", "other"];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── SchedulerPage ──────────────────────────────────────────
export function SchedulerPage() {
  const { user } = useAuth();

  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("queue");
  const [createForm, setCreateForm] = useState<CreateForm>({
    content: "",
    platform: "twitter",
    scheduled_at: "",
  });
  const [scheduleTarget, setScheduleTarget] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

  // ─── Fetch ─────────────────────────────────────────────────
  const fetchPosts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("mavis_social_posts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load posts");
    } else {
      setPosts((data as SocialPost[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // ─── Create post ───────────────────────────────────────────
  async function handleCreate() {
    if (!user) return;
    if (!createForm.content.trim()) { toast.error("Content is required"); return; }
    setSubmitting(true);
    const status: PostStatus = createForm.scheduled_at ? "scheduled" : "queued";
    const { error } = await supabase.from("mavis_social_posts").insert({
      user_id: user.id,
      content: createForm.content.trim(),
      platform: createForm.platform,
      status,
      scheduled_at: createForm.scheduled_at || null,
    });
    if (error) {
      toast.error("Failed to create post");
    } else {
      toast.success("Post created");
      setCreateForm({ content: "", platform: "twitter", scheduled_at: "" });
      setShowCreate(false);
      fetchPosts();
    }
    setSubmitting(false);
  }

  // ─── Approve post ──────────────────────────────────────────
  async function handleApprove(id: string) {
    setActionLoading(id);
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, status: "queued" } : p));
    const { error } = await supabase.from("mavis_social_posts").update({ status: "queued" }).eq("id", id);
    if (error) { toast.error("Failed to approve"); fetchPosts(); }
    else toast.success("Post approved — queued");
    setActionLoading(null);
  }

  // ─── Schedule post ─────────────────────────────────────────
  async function handleSchedule(id: string) {
    if (!scheduleDate) { toast.error("Pick a date/time"); return; }
    setScheduleLoading(id);
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, status: "scheduled", scheduled_at: scheduleDate } : p));
    const { error } = await supabase
      .from("mavis_social_posts")
      .update({ status: "scheduled", scheduled_at: new Date(scheduleDate).toISOString() })
      .eq("id", id);
    if (error) { toast.error("Failed to schedule"); fetchPosts(); }
    else toast.success("Post scheduled");
    setScheduleLoading(null);
    setScheduleTarget(null);
    setScheduleDate("");
  }

  // ─── Delete post ───────────────────────────────────────────
  async function handleDelete(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    const { error } = await supabase.from("mavis_social_posts").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); fetchPosts(); }
    else toast.success("Post removed");
  }

  // ─── Filtered posts ────────────────────────────────────────
  const queuePosts = posts.filter((p) => ["queued", "scheduled", "requires_confirmation"].includes(p.status));
  const postedPosts = posts.filter((p) => p.status === "posted");

  const twitterCharWarn = createForm.platform === "twitter" && createForm.content.length > 280;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Post Scheduler"
        subtitle="Social queue, scheduling, and publishing"
        icon={<Send size={18} />}
        actions={
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 transition-colors"
          >
            <Plus size={12} /> New Post
          </button>
        }
      />

      {/* ── Create Post Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <HudCard glowColor="gold">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-mono text-primary uppercase tracking-widest">Create Post</p>
                <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              </div>

              {/* Platform selector */}
              <div className="mb-3">
                <label className="text-xs font-mono text-muted-foreground block mb-1.5">Platform</label>
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setCreateForm((f) => ({ ...f, platform: p }))}
                      className={`px-2.5 py-1 text-xs font-mono rounded border capitalize transition-colors ${
                        createForm.platform === p
                          ? PLATFORM_COLORS[p]
                          : "bg-muted/20 border-border text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-mono text-muted-foreground">Content *</label>
                  <span className={`text-xs font-mono ${twitterCharWarn ? "text-red-400" : "text-muted-foreground"}`}>
                    {createForm.content.length}{createForm.platform === "twitter" ? " / 280" : ""}
                  </span>
                </div>
                <textarea
                  value={createForm.content}
                  onChange={(e) => setCreateForm((f) => ({ ...f, content: e.target.value }))}
                  rows={4}
                  placeholder="What's on your mind..."
                  className={`w-full bg-muted/30 border rounded px-3 py-2 text-xs font-mono focus:outline-none resize-none transition-colors ${
                    twitterCharWarn ? "border-red-500/60 focus:border-red-400/60" : "border-border focus:border-primary/40"
                  }`}
                />
                {twitterCharWarn && (
                  <p className="text-xs font-mono text-red-400 mt-0.5">Exceeds Twitter's 280 character limit</p>
                )}
              </div>

              {/* Schedule toggle */}
              <div className="mb-3">
                <label className="text-xs font-mono text-muted-foreground block mb-1.5">Schedule (optional)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={createForm.scheduled_at}
                    onChange={(e) => setCreateForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                    className="bg-muted/30 border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                  />
                  {createForm.scheduled_at ? (
                    <span className="text-xs font-mono text-blue-400">Will be scheduled</span>
                  ) : (
                    <span className="text-xs font-mono text-green-400">Will be queued immediately</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleCreate}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
                >
                  {submitting ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Create Post
                </button>
              </div>
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab Bar ───────────────────────────────────────────── */}
      <div className="flex gap-1">
        {(["queue", "calendar", "posted"] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs font-mono rounded border transition-colors capitalize ${
              activeTab === tab
                ? "bg-primary/10 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
            }`}
          >
            {tab === "queue" ? `Queue (${queuePosts.length})` : tab === "posted" ? `Posted (${postedPosts.length})` : "Calendar"}
          </button>
        ))}
      </div>

      {/* ── Queue Tab ─────────────────────────────────────────── */}
      {activeTab === "queue" && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" size={20} /></div>
          ) : queuePosts.length === 0 ? (
            <HudCard>
              <div className="text-center py-8">
                <MessageSquare size={28} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-xs font-mono text-muted-foreground">No posts in queue. Create a new one to get started.</p>
              </div>
            </HudCard>
          ) : (
            queuePosts.map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <HudCard>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded border capitalize ${PLATFORM_COLORS[post.platform] ?? PLATFORM_COLORS.other}`}>
                        {post.platform}
                      </span>
                      {post.status === "requires_confirmation" && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-amber-900/40 text-amber-300 border-amber-700">
                          Needs Approval
                        </span>
                      )}
                      {post.status === "scheduled" && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-blue-900/40 text-blue-300 border-blue-700">
                          Scheduled{post.scheduled_at ? ` for ${fmtDateTime(post.scheduled_at)}` : ""}
                        </span>
                      )}
                      {post.status === "queued" && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded border bg-green-900/40 text-green-300 border-green-700">
                          Queued
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setConfirmDelete({ id: post.id, label: post.content.slice(0, 40) + (post.content.length > 40 ? "…" : "") })}
                      className="text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <p className="text-sm text-foreground/90 line-clamp-2 mb-2">{post.content}</p>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground">
                      Created {fmtDate(post.created_at)}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {post.status === "requires_confirmation" && (
                        <button
                          onClick={() => handleApprove(post.id)}
                          disabled={actionLoading === post.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-green-900/30 border border-green-700/50 text-green-300 rounded hover:bg-green-900/50 disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === post.id ? <Loader2 size={9} className="animate-spin" /> : <CheckCircle2 size={9} />}
                          Approve
                        </button>
                      )}
                      {scheduleTarget === post.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="datetime-local"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="bg-muted/30 border border-border rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-primary/40"
                          />
                          <button
                            onClick={() => handleSchedule(post.id)}
                            disabled={scheduleLoading === post.id}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-blue-900/30 border border-blue-700/50 text-blue-300 rounded hover:bg-blue-900/50 disabled:opacity-50 transition-colors"
                          >
                            {scheduleLoading === post.id ? <Loader2 size={9} className="animate-spin" /> : <Clock size={9} />}
                            Set
                          </button>
                          <button
                            onClick={() => { setScheduleTarget(null); setScheduleDate(""); }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setScheduleTarget(post.id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted/30 border border-border text-muted-foreground rounded hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          <Calendar size={9} /> Schedule
                        </button>
                      )}
                    </div>
                  </div>
                </HudCard>
              </motion.div>
            ))
          )}
        </div>
      )}

      {/* ── Calendar Tab ─────────────────────────────────────── */}
      {activeTab === "calendar" && (() => {
        const scheduledPosts = posts.filter((p) => p.scheduled_at);
        // Build a 5-week grid starting from Monday of this week
        const now = new Date();
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        monday.setHours(0, 0, 0, 0);
        const days: Date[] = [];
        for (let i = 0; i < 35; i++) {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          days.push(d);
        }
        const postsByDay = scheduledPosts.reduce<Record<string, typeof posts>>((acc, p) => {
          const key = p.scheduled_at ? new Date(p.scheduled_at).toISOString().slice(0, 10) : "";
          if (key) (acc[key] = acc[key] ?? []).push(p);
          return acc;
        }, {});
        const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {DAY_LABELS.map((d) => (
                <p key={d} className="text-xs font-mono text-muted-foreground">{d}</p>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const key = day.toISOString().slice(0, 10);
                const dayPosts = postsByDay[key] ?? [];
                const isToday = key === now.toISOString().slice(0, 10);
                return (
                  <div
                    key={key}
                    className={`min-h-[72px] rounded border p-1.5 ${isToday ? "border-primary/40 bg-primary/5" : "border-border bg-muted/10"}`}
                  >
                    <p className={`text-xs font-mono mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                      {day.getDate()}
                    </p>
                    {dayPosts.map((p) => (
                      <div
                        key={p.id}
                        className={`text-xs font-mono px-1 py-0.5 rounded mb-0.5 truncate ${PLATFORM_COLORS[p.platform] ?? PLATFORM_COLORS.other}`}
                        title={p.content}
                      >
                        {p.platform} — {p.content.slice(0, 15)}…
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Posted Tab ────────────────────────────────────────── */}
      {activeTab === "posted" && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" size={20} /></div>
          ) : postedPosts.length === 0 ? (
            <HudCard>
              <p className="text-xs font-mono text-muted-foreground text-center py-6">No published posts yet.</p>
            </HudCard>
          ) : (
            postedPosts.map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <HudCard>
                  <div className="flex items-start gap-3">
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded border capitalize shrink-0 ${PLATFORM_COLORS[post.platform] ?? PLATFORM_COLORS.other}`}>
                      {post.platform}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground line-clamp-2">{post.content}</p>
                      <p className="text-xs font-mono text-muted-foreground mt-1">{fmtDateTime(post.created_at)}</p>
                    </div>
                    <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                  </div>
                </HudCard>
              </motion.div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.label}"?`}
        description="This action cannot be undone."
        onConfirm={async () => {
          if (!confirmDelete) return;
          await handleDelete(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
