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
} from "lucide-react";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { ConfirmDialog } from "@/components/ConfirmDialog";

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
          <Users size={28} className="text-muted-foreground" />
          <p className="text-sm font-mono text-muted-foreground">No council members found.</p>
          <p className="text-xs font-mono text-muted-foreground">
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
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-xs font-mono font-bold text-primary-foreground">
                    {unreadCount}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">{member.role}</p>
            </div>
            <span className={`text-xs font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0 ${classBadge(member.class)}`}>
              {member.class}
            </span>
          </div>

          {/* Specialty */}
          {member.specialty && (
            <p className="text-xs font-mono text-muted-foreground mb-3 border-l-2 border-border pl-2 italic">
              {member.specialty}
            </p>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="flex flex-col items-center justify-center rounded border border-border bg-muted/20 px-2 py-2">
              <span className="text-sm font-display font-bold text-amber-400 tabular-nums">
                {karma > 0 ? `+${karma}` : karma}
              </span>
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest mt-0.5">Karma</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded border border-border bg-muted/20 px-2 py-2">
              <span className="text-sm font-display font-bold text-cyan-400 tabular-nums">{memoryCount}</span>
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest mt-0.5">Memories</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded border border-border bg-muted/20 px-2 py-2">
              <span className={`text-sm font-display font-bold tabular-nums ${unreadCount > 0 ? "text-primary" : "text-muted-foreground"}`}>
                {unreadCount}
              </span>
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest mt-0.5">Unread</span>
            </div>
          </div>

          {/* Last active */}
          <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
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
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);

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
          <span className={`text-xs font-mono uppercase px-1.5 py-0.5 rounded border ${classBadge(selectedMember.class)}`}>
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
            <Brain size={24} className="text-muted-foreground" />
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
                        className="text-xs font-mono px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-400 border border-cyan-800/40"
                      >
                        #{tag}
                      </span>
                    ))}
                    <span className="text-xs font-mono text-muted-foreground ml-auto">
                      {fmtDate(mem.created_at)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmDelete({ id: mem.id, label: mem.content.slice(0, 60) })}
                  disabled={deleting === mem.id}
                  className="shrink-0 p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 opacity-0 group-hover:opacity-100"
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

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete memory?"
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
          <Star size={28} className="text-muted-foreground" />
          <p className="text-sm font-mono text-muted-foreground">No feedback yet</p>
          <p className="text-xs font-mono text-muted-foreground">
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
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mt-1">Total Ratings</div>
        </HudCard>
        <HudCard className="text-center">
          <div className="text-xl font-display font-bold text-green-400 tabular-nums">{ups}</div>
          <div className="flex items-center justify-center gap-1 mt-1">
            <ThumbsUp size={9} className="text-green-400" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Positive</span>
          </div>
        </HudCard>
        <HudCard className="text-center">
          <div className="text-xl font-display font-bold text-red-400 tabular-nums">{downs}</div>
          <div className="flex items-center justify-center gap-1 mt-1">
            <ThumbsDown size={9} className="text-red-400" />
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Negative</span>
          </div>
        </HudCard>
        <HudCard className="text-center">
          <div className={`text-xl font-display font-bold tabular-nums ${satisfactionPct >= 80 ? "text-green-400" : satisfactionPct >= 50 ? "text-amber-400" : "text-red-400"}`}>
            {satisfactionPct}%
          </div>
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mt-1">Satisfaction</div>
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
        <div className="flex justify-between text-xs font-mono text-muted-foreground mt-1">
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
                    <p className="text-xs font-body text-foreground leading-relaxed mb-2 line-clamp-2">
                      {fb.response_preview}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {fb.provider && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-800/40">
                        {fb.provider}
                      </span>
                    )}
                    {fb.mode && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/40">
                        {fb.mode}
                      </span>
                    )}
                    <span className="text-xs font-mono text-muted-foreground ml-auto">
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

// ─── Tabs ────────────────────────────────────────────────────

type TabId = "status" | "memories" | "quality";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "status",   label: "Council Status",    icon: <Users size={12} /> },
  { id: "memories", label: "Agent Memories",    icon: <Brain size={12} /> },
  { id: "quality",  label: "Response Quality",  icon: <MessageSquare size={12} /> },
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
        {activeTab === "status" && <CouncilStatusTab userId={userId} />}
        {activeTab === "memories" && <AgentMemoriesTab userId={userId} />}
        {activeTab === "quality" && <ResponseQualityTab userId={userId} />}
      </div>
    </div>
  );
}
