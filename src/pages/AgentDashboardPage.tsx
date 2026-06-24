// ============================================================
// VANTARA.EXE — AgentDashboardPage
// Council status, agent memories, response quality
// ============================================================
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Users,
  Brain,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Trash2,
  ChevronDown,
  MessageSquare,
  Activity,
  Star,
  Zap,
  Network,
  ChevronRight,
  Clock,
  XCircle,
  CheckCircle2,
  RefreshCw,
  Play,
} from "lucide-react";
import { PageHeader, HudCard } from "@/components/SharedUI";

// ─── Types ──────────────────────────────────────────────────

interface CouncilMember {
  id: string;
  name: string;
  role: string;
  class: string;
  specialty: string | null;
  updated_at: string;
}

interface MemberStat {
  member: CouncilMember;
  karma: number;
  memoryCount: number;
  unreadCount: number;
  lastActive: string | null;
}

interface AgentMemory {
  id: string;
  council_member_id: string;
  content: string;
  tags: string[] | null;
  created_at: string;
}

interface ResponseFeedback {
  id: string;
  rating: "up" | "down";
  response_preview: string | null;
  provider: string | null;
  mode: string | null;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────

const CLASS_COLORS: Record<string, string> = {
  core: "text-primary border-primary/40 bg-primary/10",
  advisory: "text-blue-400 border-blue-400/40 bg-blue-900/20",
  "think-tank": "text-purple-400 border-purple-400/40 bg-purple-900/20",
  shadows: "text-red-400 border-red-400/40 bg-red-900/20",
};

function classBadge(cls: string) {
  return CLASS_COLORS[cls] ?? "text-muted-foreground border-border bg-muted/30";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtRelative(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Tab: Council Status ─────────────────────────────────────

function CouncilStatusTab({ userId }: { userId: string }) {
  const [stats, setStats] = useState<MemberStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadStats() {
    setLoading(true);
    try {
      // Load council members
      const { data: members, error: membersErr } = await (supabase as any)
        .from("councils")
        .select("id, name, role, class, specialty, updated_at")
        .eq("user_id", userId)
        .order("name");

      if (membersErr) throw membersErr;
      if (!members || members.length === 0) {
        setStats([]);
        setLoading(false);
        return;
      }

      // Load karma for all members in one query
      const memberIds = members.map((m: CouncilMember) => m.id);
      const { data: karmaRows } = await (supabase as any)
        .from("mavis_agent_karma")
        .select("agent_id, karma, updated_at")
        .eq("user_id", userId)
        .in("agent_id", memberIds);

      const karmaMap: Record<string, { karma: number; updated_at: string }> = {};
      for (const row of karmaRows ?? []) {
        karmaMap[row.agent_id] = { karma: row.karma ?? 0, updated_at: row.updated_at };
      }

      // Load memory counts per member
      const { data: memoryCounts } = await (supabase as any)
        .from("mavis_council_memory")
        .select("council_member_id")
        .eq("user_id", userId)
        .in("council_member_id", memberIds);

      const memCountMap: Record<string, number> = {};
      for (const row of memoryCounts ?? []) {
        memCountMap[row.council_member_id] = (memCountMap[row.council_member_id] ?? 0) + 1;
      }

      // Load unread message counts per member
      const { data: unreadRows } = await (supabase as any)
        .from("mavis_council_messages")
        .select("to_member_id")
        .eq("user_id", userId)
        .eq("read", false)
        .in("to_member_id", memberIds);

      const unreadMap: Record<string, number> = {};
      for (const row of unreadRows ?? []) {
        unreadMap[row.to_member_id] = (unreadMap[row.to_member_id] ?? 0) + 1;
      }

      const built: MemberStat[] = members.map((m: CouncilMember) => ({
        member: m,
        karma: karmaMap[m.id]?.karma ?? 0,
        memoryCount: memCountMap[m.id] ?? 0,
        unreadCount: unreadMap[m.id] ?? 0,
        lastActive: karmaMap[m.id]?.updated_at ?? m.updated_at ?? null,
      }));

      setStats(built);
    } catch (err: any) {
      toast.error("Failed to load council stats: " + (err?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <HudCard>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Users size={28} className="text-muted-foreground/40" />
          <p className="text-sm font-mono text-muted-foreground">No council members found.</p>
          <p className="text-[11px] font-mono text-muted-foreground/60">
            Create council members to see their status here.
          </p>
        </div>
      </HudCard>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {stats.map(({ member, karma, memoryCount, unreadCount, lastActive }) => (
        <HudCard key={member.id} glowColor="purple">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-display font-bold text-foreground truncate">{member.name}</h3>
                {unreadCount > 0 && (
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[9px] font-mono font-bold text-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">{member.role}</p>
            </div>
            <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0 ${classBadge(member.class)}`}>
              {member.class}
            </span>
          </div>

          {/* Specialty */}
          {member.specialty && (
            <p className="text-[10px] font-mono text-muted-foreground/70 mb-3 border-l-2 border-border pl-2 italic">
              {member.specialty}
            </p>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="flex flex-col items-center justify-center rounded border border-border bg-muted/20 px-2 py-2">
              <span className="text-sm font-display font-bold text-amber-400 tabular-nums">
                {karma > 0 ? `+${karma}` : karma}
              </span>
              <span className="text-[8px] font-mono text-muted-foreground uppercase tracking-widest mt-0.5">Karma</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded border border-border bg-muted/20 px-2 py-2">
              <span className="text-sm font-display font-bold text-cyan-400 tabular-nums">{memoryCount}</span>
              <span className="text-[8px] font-mono text-muted-foreground uppercase tracking-widest mt-0.5">Memories</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded border border-border bg-muted/20 px-2 py-2">
              <span className={`text-sm font-display font-bold tabular-nums ${unreadCount > 0 ? "text-primary" : "text-muted-foreground"}`}>
                {unreadCount}
              </span>
              <span className="text-[8px] font-mono text-muted-foreground uppercase tracking-widest mt-0.5">Unread</span>
            </div>
          </div>

          {/* Last active */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/60">
            <Activity size={9} />
            <span>Last active: {fmtRelative(lastActive)}</span>
          </div>
        </HudCard>
      ))}
    </div>
  );
}

// ─── Tab: Agent Memories ─────────────────────────────────────

const PAGE_SIZE = 20;

function AgentMemoriesTab({ userId }: { userId: string }) {
  const [members, setMembers] = useState<CouncilMember[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("councils")
        .select("id, name, role, class, specialty, updated_at")
        .eq("user_id", userId)
        .order("name");
      setMembers(data ?? []);
      if (data?.length) setSelectedId(data[0].id);
      setLoadingMembers(false);
    })();
  }, [userId]);

  useEffect(() => {
    if (!selectedId) return;
    setMemories([]);
    setOffset(0);
    fetchMemories(selectedId, 0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function fetchMemories(memberId: string, from: number, replace: boolean) {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("mavis_council_memory")
        .select("id, council_member_id, content, tags, created_at")
        .eq("user_id", userId)
        .eq("council_member_id", memberId)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      const rows = data ?? [];
      setHasMore(rows.length === PAGE_SIZE);
      if (replace) {
        setMemories(rows);
      } else {
        setMemories((prev) => [...prev, ...rows]);
      }
      setOffset(from + rows.length);
    } catch (err: any) {
      toast.error("Failed to load memories: " + (err?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(memId: string) {
    setDeleting(memId);
    try {
      const { error } = await (supabase as any)
        .from("mavis_council_memory")
        .delete()
        .eq("id", memId)
        .eq("user_id", userId);
      if (error) throw error;
      setMemories((prev) => prev.filter((m) => m.id !== memId));
      toast.success("Memory deleted");
    } catch (err: any) {
      toast.error("Delete failed: " + (err?.message ?? "unknown"));
    } finally {
      setDeleting(null);
    }
  }

  if (loadingMembers) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <HudCard>
        <p className="text-xs font-mono text-muted-foreground text-center py-6">No council members found.</p>
      </HudCard>
    );
  }

  const selectedMember = members.find((m) => m.id === selectedId);

  return (
    <div className="space-y-4">
      {/* Member selector */}
      <div className="relative inline-flex items-center gap-2">
        <Brain size={14} className="text-cyan-400 shrink-0" />
        <div className="relative">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="appearance-none text-sm font-mono bg-card border border-border rounded-lg pl-3 pr-8 py-2 text-foreground focus:outline-none focus:border-primary/50 transition-colors cursor-pointer"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id} className="bg-card">
                {m.name} — {m.role}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        {selectedMember && (
          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${classBadge(selectedMember.class)}`}>
            {selectedMember.class}
          </span>
        )}
      </div>

      {/* Memory list */}
      {loading && memories.length === 0 ? (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-primary" size={20} />
        </div>
      ) : memories.length === 0 ? (
        <HudCard>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Brain size={24} className="text-muted-foreground/40" />
            <p className="text-xs font-mono text-muted-foreground">No memories for this agent.</p>
          </div>
        </HudCard>
      ) : (
        <div className="space-y-2">
          {memories.map((mem) => (
            <HudCard key={mem.id} className="group">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-body text-foreground/90 leading-relaxed whitespace-pre-wrap mb-2">
                    {mem.content}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(mem.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-400 border border-cyan-800/40"
                      >
                        #{tag}
                      </span>
                    ))}
                    <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">
                      {fmtDate(mem.created_at)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(mem.id)}
                  disabled={deleting === mem.id}
                  className="shrink-0 p-1.5 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 opacity-0 group-hover:opacity-100"
                  title="Delete memory"
                >
                  {deleting === mem.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                </button>
              </div>
            </HudCard>
          ))}

          {hasMore && (
            <button
              onClick={() => fetchMemories(selectedId, offset, false)}
              disabled={loading}
              className="w-full py-2 text-xs font-mono text-muted-foreground hover:text-primary border border-border hover:border-primary/30 rounded-lg transition-colors disabled:opacity-40"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Loading...
                </span>
              ) : (
                "Load more"
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Response Quality ───────────────────────────────────

function ResponseQualityTab({ userId }: { userId: string }) {
  const [feedback, setFeedback] = useState<ResponseFeedback[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await (supabase as any)
          .from("mavis_response_feedback")
          .select("id, rating, response_preview, provider, mode, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;
        setFeedback(data ?? []);
      } catch (err: any) {
        toast.error("Failed to load feedback: " + (err?.message ?? "unknown"));
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  const total = feedback.length;
  const ups = feedback.filter((f) => f.rating === "up").length;
  const downs = total - ups;
  const satisfactionPct = total > 0 ? Math.round((ups / total) * 100) : 0;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  if (total === 0) {
    return (
      <HudCard>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Star size={28} className="text-muted-foreground/40" />
          <p className="text-sm font-mono text-muted-foreground">No feedback yet</p>
          <p className="text-[11px] font-mono text-muted-foreground/60">
            Use 👍/👎 in chat to rate responses
          </p>
        </div>
      </HudCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <HudCard className="text-center">
          <div className="text-xl font-display font-bold text-foreground tabular-nums">{total}</div>
          <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mt-1">Total Ratings</div>
        </HudCard>
        <HudCard className="text-center">
          <div className="text-xl font-display font-bold text-green-400 tabular-nums">{ups}</div>
          <div className="flex items-center justify-center gap-1 mt-1">
            <ThumbsUp size={9} className="text-green-400" />
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Positive</span>
          </div>
        </HudCard>
        <HudCard className="text-center">
          <div className="text-xl font-display font-bold text-red-400 tabular-nums">{downs}</div>
          <div className="flex items-center justify-center gap-1 mt-1">
            <ThumbsDown size={9} className="text-red-400" />
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Negative</span>
          </div>
        </HudCard>
        <HudCard className="text-center">
          <div className={`text-xl font-display font-bold tabular-nums ${satisfactionPct >= 80 ? "text-green-400" : satisfactionPct >= 50 ? "text-amber-400" : "text-red-400"}`}>
            {satisfactionPct}%
          </div>
          <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mt-1">Satisfaction</div>
        </HudCard>
      </div>

      {/* Satisfaction bar */}
      <HudCard>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-muted-foreground">Satisfaction rate</span>
          <span className="text-xs font-mono text-primary font-bold">{satisfactionPct}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              satisfactionPct >= 80 ? "bg-green-500" : satisfactionPct >= 50 ? "bg-amber-500" : "bg-red-500"
            }`}
            style={{ width: `${satisfactionPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground/50 mt-1">
          <span>{ups} up</span>
          <span>{downs} down</span>
        </div>
      </HudCard>

      {/* Recent feedback list */}
      <div>
        <h3 className="text-xs font-mono text-primary uppercase tracking-widest mb-3">Recent Feedback</h3>
        <div className="space-y-2">
          {feedback.map((fb) => (
            <HudCard key={fb.id}>
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {fb.rating === "up" ? (
                    <ThumbsUp size={14} className="text-green-400" />
                  ) : (
                    <ThumbsDown size={14} className="text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {fb.response_preview && (
                    <p className="text-xs font-body text-foreground/80 leading-relaxed mb-2 line-clamp-2">
                      {fb.response_preview}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {fb.provider && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-800/40">
                        {fb.provider}
                      </span>
                    )}
                    {fb.mode && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/40">
                        {fb.mode}
                      </span>
                    )}
                    <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">
                      {fmtDate(fb.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            </HudCard>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── AutonomousTasksTab ──────────────────────────────────────
interface AutonomousTask {
  id: string;
  goal: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  plan: Array<{ type: string; description: string; completed?: boolean; output?: string; error?: string }>;
  current_step: number;
  context: { steps_completed?: Array<{ step: number; type: string; description: string; output: string }>; source?: string };
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const TASK_STATUS_CONFIG = {
  pending:   { label: "Pending",   color: "text-zinc-400",    bg: "bg-zinc-500/10 border-zinc-500/20" },
  running:   { label: "Running",   color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
  paused:    { label: "Paused",    color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
  completed: { label: "Completed", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  failed:    { label: "Failed",    color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
};

function AutonomousTasksTab({ userId }: { userId: string }) {
  const [tasks, setTasks] = useState<AutonomousTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "done">("active");

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000); // auto-refresh every 15s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function load() {
    const statusFilter = filter === "active"
      ? ["pending", "running", "paused"]
      : filter === "done"
        ? ["completed", "failed"]
        : ["pending", "running", "paused", "completed", "failed"];

    const { data } = await (supabase as any)
      .from("mavis_autonomous_tasks")
      .select("*")
      .eq("user_id", userId)
      .in("status", statusFilter)
      .order("updated_at", { ascending: false })
      .limit(30);
    setTasks(data ?? []);
    setLoading(false);
  }

  async function cancelTask(id: string) {
    await (supabase as any).from("mavis_autonomous_tasks").update({ status: "failed", error: "Cancelled by operator" }).eq("id", id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: "failed" as const, error: "Cancelled by operator" } : t));
  }

  function fmtTime(iso: string) {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const activeCounts = tasks.filter(t => t.status === "pending" || t.status === "running").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(["all", "active", "done"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-mono px-3 py-1 rounded-full border transition-colors capitalize ${
                filter === f
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
          {activeCounts > 0 && (
            <span className="text-xs font-mono text-blue-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
              {activeCounts} running
            </span>
          )}
        </div>
        <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-muted/20 border border-border rounded-xl p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <HudCard>
          <div className="text-center py-10">
            <Zap size={28} className="mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-xs font-mono text-muted-foreground">No {filter !== "all" ? filter : ""} autonomous tasks</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Tasks appear here when MAVIS executes standing orders or multi-step goals.</p>
          </div>
        </HudCard>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const sc = TASK_STATUS_CONFIG[task.status] ?? TASK_STATUS_CONFIG.pending;
            const isExpanded = expanded === task.id;
            const progress = task.plan.length > 0
              ? Math.round((task.current_step / task.plan.length) * 100)
              : 0;
            const steps = task.context?.steps_completed ?? [];

            return (
              <HudCard key={task.id} className="overflow-hidden">
                <div
                  className="flex items-start gap-3 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : task.id)}
                >
                  <div className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold ${sc.bg} ${sc.color}`}>
                    {sc.label}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{task.goal.replace(/^\[Standing Order:.*?\]\n?/, "")}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {task.plan.length > 0 && (
                        <span className="text-xs font-mono text-muted-foreground">
                          Step {Math.min(task.current_step + 1, task.plan.length)}/{task.plan.length}
                        </span>
                      )}
                      {task.context?.source && (
                        <span className="text-xs font-mono text-muted-foreground/60">{task.context.source}</span>
                      )}
                      <span className="text-xs font-mono text-muted-foreground/60">{fmtTime(task.updated_at)}</span>
                    </div>
                    {task.plan.length > 0 && (
                      <div className="mt-2 h-1 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${task.status === "completed" ? "bg-emerald-500" : task.status === "failed" ? "bg-red-500" : "bg-blue-500"}`}
                          style={{ width: `${task.status === "completed" ? 100 : progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(task.status === "pending" || task.status === "running") && (
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelTask(task.id); }}
                        className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                        title="Cancel"
                      >
                        <XCircle size={13} />
                      </button>
                    )}
                    <ChevronRight size={13} className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
                    {/* Plan steps */}
                    {task.plan.length > 0 && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Execution Plan</p>
                        <div className="space-y-1">
                          {task.plan.map((step: any, i: number) => {
                            const done = i < task.current_step;
                            const active = i === task.current_step && task.status === "running";
                            const stepOutput = steps.find((s: any) => s.step === i);
                            return (
                              <div key={i} className={`flex items-start gap-2 text-xs p-2 rounded ${active ? "bg-blue-500/5 border border-blue-500/20" : ""}`}>
                                <span className={`shrink-0 mt-0.5 ${done ? "text-emerald-400" : active ? "text-blue-400" : "text-muted-foreground/40"}`}>
                                  {done ? "✓" : active ? "▶" : `${i + 1}.`}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <span className={`font-mono ${done ? "text-muted-foreground" : active ? "text-foreground" : "text-muted-foreground/50"}`}>
                                    [{step.type}] {step.description}
                                  </span>
                                  {stepOutput?.output && (
                                    <p className="text-[10px] text-muted-foreground/70 mt-0.5 line-clamp-2">{stepOutput.output}</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Final result */}
                    {task.result && (
                      <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                        <p className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest mb-1">Result</p>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{task.result}</p>
                      </div>
                    )}

                    {/* Error */}
                    {task.error && (
                      <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                        <p className="text-[10px] font-mono text-red-400 uppercase tracking-widest mb-1">Error</p>
                        <p className="text-xs text-red-400/80">{task.error}</p>
                      </div>
                    )}

                    {task.completed_at && (
                      <p className="text-[10px] font-mono text-muted-foreground/50">Completed: {new Date(task.completed_at).toLocaleString()}</p>
                    )}
                  </div>
                )}
              </HudCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── A2ATasksTab ─────────────────────────────────────────────
interface A2ATask {
  id: string;
  skill_id: string;
  calling_agent_url: string | null;
  input: any;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result: any;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const A2A_STATUS_CONFIG = {
  pending:   { label: "Pending",   color: "text-zinc-400",    icon: Clock },
  running:   { label: "Running",   color: "text-blue-400",    icon: Play },
  completed: { label: "Done",      color: "text-emerald-400", icon: CheckCircle2 },
  failed:    { label: "Failed",    color: "text-red-400",     icon: XCircle },
  cancelled: { label: "Cancelled", color: "text-zinc-500",    icon: XCircle },
};

function A2ATasksTab({ userId }: { userId: string }) {
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const { data } = await (supabase as any)
      .from("mavis_a2a_tasks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);
    setTasks(data ?? []);
    setLoading(false);
  }

  function fmtTime(iso: string) {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const pendingCount = tasks.filter(t => t.status === "pending" || t.status === "running").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-primary" />
          <span className="text-xs font-mono text-muted-foreground">
            Inbound tasks from external agents via A2A protocol
          </span>
          {pendingCount > 0 && (
            <span className="text-xs font-mono text-blue-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
              {pendingCount} processing
            </span>
          )}
        </div>
        <button onClick={load} className="text-xs font-mono text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="bg-muted/20 border border-border rounded-xl p-4 animate-pulse h-14" />)}
        </div>
      ) : tasks.length === 0 ? (
        <HudCard>
          <div className="text-center py-10">
            <Network size={28} className="mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-xs font-mono text-muted-foreground">No inbound A2A tasks yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs mx-auto">
              External agents can delegate tasks to MAVIS via the A2A gateway.
              They'll appear here and be auto-executed.
            </p>
          </div>
        </HudCard>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const sc = A2A_STATUS_CONFIG[task.status] ?? A2A_STATUS_CONFIG.pending;
            const SIcon = sc.icon;
            const isExpanded = expanded === task.id;
            const inputText = typeof task.input === "string"
              ? task.input
              : task.input?.message ?? task.input?.text ?? task.input?.query ?? JSON.stringify(task.input ?? {});
            const resultText = typeof task.result === "string"
              ? task.result
              : task.result?.reply ?? JSON.stringify(task.result ?? {});

            return (
              <HudCard key={task.id} className="overflow-hidden">
                <div
                  className="flex items-start gap-3 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : task.id)}
                >
                  <SIcon size={14} className={`${sc.color} mt-0.5 shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground capitalize">
                        {(task.skill_id ?? "task").replace(/_/g, " ")}
                      </span>
                      <span className={`text-[10px] font-mono ${sc.color}`}>{sc.label}</span>
                      {task.calling_agent_url && (
                        <span className="text-[10px] font-mono text-muted-foreground/50 truncate max-w-[160px]">
                          from {task.calling_agent_url}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{inputText.slice(0, 120)}</p>
                    <p className="text-[10px] font-mono text-muted-foreground/50 mt-0.5">{fmtTime(task.created_at)}</p>
                  </div>
                  <ChevronRight size={13} className={`text-muted-foreground transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
                    <div>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1">Input</p>
                      <p className="text-xs text-muted-foreground bg-muted/20 rounded p-2 whitespace-pre-wrap">{inputText}</p>
                    </div>
                    {resultText && resultText !== "{}" && (
                      <div>
                        <p className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest mb-1">Result</p>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{resultText.slice(0, 800)}</p>
                      </div>
                    )}
                    {task.error && (
                      <div className="p-2 bg-red-500/5 border border-red-500/20 rounded">
                        <p className="text-xs text-red-400">{task.error}</p>
                      </div>
                    )}
                  </div>
                )}
              </HudCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Action Queue ───────────────────────────────────────

interface ActionQueueItem {
  id: string;
  action_type: string;
  action_payload: Record<string, any>;
  status: string;
  autonomy_tier: string;
  priority: number;
  source_system: string | null;
  source_context: string | null;
  approved_at: string | null;
  executed_at: string | null;
  result_data: Record<string, any> | null;
  created_at: string;
  expires_at: string;
}

const ACTION_TYPE_COLORS: Record<string, string> = {
  draft_email:    "text-blue-400 bg-blue-900/20 border-blue-800/40",
  schedule_event: "text-purple-400 bg-purple-900/20 border-purple-800/40",
  create_task:    "text-green-400 bg-green-900/20 border-green-800/40",
  post_social:    "text-orange-400 bg-orange-900/20 border-orange-800/40",
  make_call:      "text-red-400 bg-red-900/20 border-red-800/40",
};

function actionTypeColor(type: string) {
  return ACTION_TYPE_COLORS[type] ?? "text-muted-foreground bg-muted/30 border-border";
}

const QUEUE_STATUS_COLORS: Record<string, string> = {
  pending:  "text-amber-400 bg-amber-900/20 border-amber-800/40",
  approved: "text-blue-400 bg-blue-900/20 border-blue-800/40",
  executed: "text-emerald-400 bg-emerald-900/20 border-emerald-800/40",
  rejected: "text-zinc-400 bg-zinc-900/20 border-zinc-800/40",
  expired:  "text-red-400 bg-red-900/20 border-red-800/40",
};

function queueStatusColor(status: string) {
  return QUEUE_STATUS_COLORS[status] ?? "text-muted-foreground bg-muted/30 border-border";
}

function renderPayloadPreview(actionType: string, payload: Record<string, any>) {
  if (!payload || Object.keys(payload).length === 0) return null;
  const fields: { label: string; value: string }[] = [];

  if (actionType === "draft_email") {
    if (payload.to) fields.push({ label: "To", value: String(payload.to) });
    if (payload.subject) fields.push({ label: "Subject", value: String(payload.subject) });
  } else if (actionType === "schedule_event") {
    if (payload.title) fields.push({ label: "Event", value: String(payload.title) });
    if (payload.start) fields.push({ label: "Start", value: String(payload.start) });
  } else if (actionType === "create_task") {
    if (payload.title) fields.push({ label: "Task", value: String(payload.title) });
    if (payload.due_date) fields.push({ label: "Due", value: String(payload.due_date) });
  } else if (actionType === "post_social") {
    if (payload.platform) fields.push({ label: "Platform", value: String(payload.platform) });
    if (payload.content) fields.push({ label: "Content", value: String(payload.content).slice(0, 80) + (String(payload.content).length > 80 ? "..." : "") });
  } else if (actionType === "make_call") {
    if (payload.to) fields.push({ label: "To", value: String(payload.to) });
    if (payload.purpose) fields.push({ label: "Purpose", value: String(payload.purpose) });
  } else {
    const keys = Object.keys(payload).slice(0, 3);
    for (const k of keys) {
      const v = payload[k];
      if (v !== null && v !== undefined && typeof v !== "object") {
        fields.push({ label: k, value: String(v).slice(0, 60) });
      }
    }
  }

  if (fields.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
      {fields.map(({ label, value }) => (
        <span key={label} className="text-[10px] font-mono text-muted-foreground">
          <span className="text-muted-foreground/50">{label}:</span> {value}
        </span>
      ))}
    </div>
  );
}

function ActionQueueTab({ userId }: { userId: string }) {
  const [items, setItems] = useState<ActionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "executed" | "rejected">("all");
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await (supabase as any)
        .from("mavis_action_queue")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      setItems(data ?? []);
    } catch (err: any) {
      toast.error("Failed to load action queue: " + (err?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }

  async function doAction(item: ActionQueueItem, action: "approve" | "reject" | "execute") {
    setActingId(item.id);
    try {
      const { error } = await (supabase as any).functions.invoke("mavis-action-executor", {
        body: { action, queue_item_id: item.id, userId },
      });
      if (error) throw error;
      toast.success(`Action ${action}d`);
      await load();
    } catch (err: any) {
      toast.error(`Failed to ${action}: ` + (err?.message ?? "unknown"));
    } finally {
      setActingId(null);
    }
  }

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);
  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-mono font-bold text-foreground">Action Queue</h3>
        {pendingCount > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
            {pendingCount} pending
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1 flex-wrap">
        {(["all", "pending", "approved", "executed", "rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs font-mono px-3 py-1 rounded-full border transition-colors capitalize ${
              filter === f
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-muted/20 border border-border rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <HudCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 size={28} className="text-muted-foreground/40" />
            <p className="text-sm font-mono text-muted-foreground">No actions in queue</p>
            <p className="text-[11px] font-mono text-muted-foreground/60">
              When MAVIS suggests actions, they'll appear here for your review.
            </p>
          </div>
        </HudCard>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const isRejected = item.status === "rejected";
            return (
              <HudCard key={item.id} className={isRejected ? "opacity-50" : ""}>
                {/* Top row */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${actionTypeColor(item.action_type)}`}>
                    {item.action_type.replace(/_/g, " ")}
                  </span>
                  <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${queueStatusColor(item.status)}`}>
                    {item.status}
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border bg-muted/20 text-muted-foreground">
                    P{item.priority}
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">
                    {fmtDate(item.created_at)}
                  </span>
                </div>

                {/* Description */}
                {item.source_context && (
                  <p className="text-xs font-body text-foreground/80 leading-relaxed mb-1">
                    {item.source_context}
                  </p>
                )}

                {/* Payload preview */}
                {renderPayloadPreview(item.action_type, item.action_payload ?? {})}

                {/* Executed result */}
                {item.status === "executed" && item.result_data && (
                  <div className="mt-2 p-2 rounded bg-emerald-900/10 border border-emerald-800/30">
                    <p className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest mb-0.5">Result</p>
                    <p className="text-xs font-mono text-muted-foreground">
                      {typeof item.result_data === "string"
                        ? String(item.result_data).slice(0, 200)
                        : (item.result_data as any)?.summary ?? (item.result_data as any)?.message ?? JSON.stringify(item.result_data).slice(0, 200)}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                {(item.status === "pending" || item.status === "approved") && (
                  <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/40">
                    {item.status === "pending" && (
                      <>
                        <button
                          onClick={() => doAction(item, "approve")}
                          disabled={actingId === item.id}
                          className="flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded border border-emerald-800/40 bg-emerald-900/10 text-emerald-400 hover:bg-emerald-900/20 transition-colors disabled:opacity-40"
                        >
                          {actingId === item.id ? <Loader2 size={10} className="animate-spin" /> : "Approve"}
                        </button>
                        <button
                          onClick={() => doAction(item, "reject")}
                          disabled={actingId === item.id}
                          className="flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded border border-red-800/40 bg-red-900/10 text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {item.status === "approved" && (
                      <button
                        onClick={() => doAction(item, "execute")}
                        disabled={actingId === item.id}
                        className="flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded border border-blue-800/40 bg-blue-900/10 text-blue-400 hover:bg-blue-900/20 transition-colors disabled:opacity-40"
                      >
                        {actingId === item.id ? <Loader2 size={10} className="animate-spin" /> : "Execute"}
                      </button>
                    )}
                  </div>
                )}
              </HudCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Morning Brief ──────────────────────────────────────

interface BriefResult {
  summary: string;
  urgent_items: string[];
  calendar_preview: string;
  actions_queued: number;
}

function ProactiveAgentTab({ userId, onSwitchToQueue }: { userId: string; onSwitchToQueue: () => void }) {
  const [running, setRunning] = useState(false);
  const [lastBrief, setLastBrief] = useState<BriefResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBrief() {
    setRunning(true);
    setError(null);
    try {
      const { data, error: fnErr } = await (supabase as any).functions.invoke("mavis-proactive-agent", {
        body: { action: "run_brief", userId },
      });
      if (fnErr) throw fnErr;
      setLastBrief(data ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Unknown error running morning brief");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <HudCard>
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-display font-bold text-foreground">MAVIS Morning Brief</h3>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              MAVIS reads your emails, calendar, and tasks, then surfaces suggested actions for review.
            </p>
          </div>
          <button
            onClick={runBrief}
            disabled={running}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-lg border border-primary/30 bg-primary/10 text-primary text-sm font-mono hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {running ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Running Morning Brief...
              </>
            ) : (
              "Run Morning Brief"
            )}
          </button>
        </div>
      </HudCard>

      {error && (
        <HudCard className="border-destructive/30 bg-destructive/5">
          <p className="text-xs font-mono text-destructive">{error}</p>
        </HudCard>
      )}

      {lastBrief && (
        <div className="space-y-3">
          {/* Summary */}
          {lastBrief.summary && (
            <HudCard>
              <p className="text-[10px] font-mono text-primary uppercase tracking-widest mb-2">Summary</p>
              <p className="text-sm font-body text-foreground/90 leading-relaxed">{lastBrief.summary}</p>
            </HudCard>
          )}

          {/* Urgent items */}
          {lastBrief.urgent_items?.length > 0 && (
            <HudCard>
              <p className="text-[10px] font-mono text-amber-400 uppercase tracking-widest mb-2">Urgent Items</p>
              <div className="flex flex-col gap-1.5">
                {lastBrief.urgent_items.map((urgentItem, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-800/40 bg-amber-900/20 text-amber-400 mt-0.5">
                      URGENT
                    </span>
                    <span className="text-xs font-body text-foreground/80">{urgentItem}</span>
                  </div>
                ))}
              </div>
            </HudCard>
          )}

          {/* Calendar preview */}
          {lastBrief.calendar_preview && (
            <HudCard>
              <p className="text-[10px] font-mono text-purple-400 uppercase tracking-widest mb-2">Calendar Preview</p>
              <p className="text-xs font-body text-foreground/80 leading-relaxed whitespace-pre-wrap">{lastBrief.calendar_preview}</p>
            </HudCard>
          )}

          {/* Actions queued */}
          {lastBrief.actions_queued != null && (
            <HudCard className="border-primary/20 bg-primary/5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-primary">
                  {lastBrief.actions_queued} action{lastBrief.actions_queued !== 1 ? "s" : ""} queued for review
                </p>
                <button
                  onClick={onSwitchToQueue}
                  className="text-xs font-mono text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
                >
                  View Action Queue
                </button>
              </div>
            </HudCard>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────

type TabId = "status" | "memories" | "quality" | "tasks" | "a2a" | "queue" | "brief";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "status",   label: "Council Status",    icon: <Users size={12} /> },
  { id: "memories", label: "Agent Memories",    icon: <Brain size={12} /> },
  { id: "quality",  label: "Response Quality",  icon: <MessageSquare size={12} /> },
  { id: "tasks",    label: "Autonomous Tasks",  icon: <Zap size={12} /> },
  { id: "a2a",      label: "A2A Inbox",         icon: <Network size={12} /> },
  { id: "queue",    label: "Action Queue",      icon: <CheckCircle2 size={12} /> },
  { id: "brief",    label: "Morning Brief",     icon: <RefreshCw size={12} /> },
];

// ─── AgentDashboardPage ──────────────────────────────────────

export function AgentDashboardPage() {
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("status");

  const userId = session?.user?.id;

  if (!userId) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Agent Dashboard"
          subtitle="Council status, memories, response quality"
          icon={<Activity size={18} />}
        />
        <HudCard>
          <p className="text-xs font-mono text-muted-foreground text-center py-6">
            Not authenticated. Please sign in.
          </p>
        </HudCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent Dashboard"
        subtitle="Council status, agent memories, response quality"
        icon={<Activity size={18} />}
      />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-mono rounded-t transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "status"   && <CouncilStatusTab userId={userId} />}
        {activeTab === "memories" && <AgentMemoriesTab userId={userId} />}
        {activeTab === "quality"  && <ResponseQualityTab userId={userId} />}
        {activeTab === "tasks"    && <AutonomousTasksTab userId={userId} />}
        {activeTab === "a2a"      && <A2ATasksTab userId={userId} />}
        {activeTab === "queue"    && <ActionQueueTab userId={userId} />}
        {activeTab === "brief"    && <ProactiveAgentTab userId={userId} onSwitchToQueue={() => setActiveTab("queue")} />}
      </div>
    </div>
  );
}
