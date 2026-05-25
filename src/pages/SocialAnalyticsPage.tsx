// ============================================================
// VANTARA.EXE — SocialAnalyticsPage
// Social post performance metrics across platforms
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BarChart2,
  Eye,
  Heart,
  MessageCircle,
  Repeat2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { supabase as _supabase } from "@/integrations/supabase/client";
const supabase = _supabase as any;
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";

// ─── Types ──────────────────────────────────────────────────
interface SocialPost {
  id: string;
  user_id: string;
  content: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  external_post_id: string | null;
}

interface PostAnalytics {
  id: string;
  user_id: string;
  post_id: string;
  platform: string;
  external_post_id: string | null;
  impressions: number | null;
  likes: number | null;
  replies_count: number | null;
  reposts: number | null;
  profile_clicks: number | null;
  fetched_at: string;
}

interface PostWithAnalytics extends SocialPost {
  analytics: PostAnalytics | null;
}

type PlatformFilter = "all" | "twitter" | "linkedin" | "instagram";
type SortBy = "impressions" | "likes" | "date";

// ─── Helpers ────────────────────────────────────────────────
const PLATFORM_COLORS: Record<string, string> = {
  twitter: "bg-sky-900/50 text-sky-300 border-sky-700",
  linkedin: "bg-blue-900/50 text-blue-300 border-blue-700",
  instagram: "bg-pink-900/50 text-pink-300 border-pink-700",
  youtube: "bg-red-900/50 text-red-300 border-red-700",
  other: "bg-zinc-800/50 text-zinc-300 border-zinc-600",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function engagementRate(likes: number | null, impressions: number | null) {
  if (!likes || !impressions || impressions === 0) return null;
  return ((likes / impressions) * 100).toFixed(2);
}

// ─── SocialAnalyticsPage ────────────────────────────────────
export function SocialAnalyticsPage() {
  const { user } = useAuth();

  const [posts, setPosts] = useState<PostWithAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("date");

  // ─── Data Loading ───────────────────────────────────────────
  const loadPosts = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [postsRes, analyticsRes] = await Promise.all([
      supabase
        .from("mavis_social_posts")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "posted")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("social_post_analytics")
        .select("*")
        .eq("user_id", user.id),
    ]);

    const analyticsMap: Record<string, PostAnalytics> = {};
    for (const a of (analyticsRes.data || []) as PostAnalytics[]) {
      analyticsMap[a.post_id] = a;
    }

    const merged: PostWithAnalytics[] = (
      (postsRes.data || []) as SocialPost[]
    ).map((p) => ({
      ...p,
      analytics: analyticsMap[p.id] ?? null,
    }));

    setPosts(merged);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  // ─── Filtered + Sorted List ─────────────────────────────────
  const filtered = posts.filter((p) =>
    platformFilter === "all" ? true : p.platform === platformFilter
  );

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "impressions") {
      return (b.analytics?.impressions ?? -1) - (a.analytics?.impressions ?? -1);
    }
    if (sortBy === "likes") {
      return (b.analytics?.likes ?? -1) - (a.analytics?.likes ?? -1);
    }
    // date
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // ─── Summary Stats ──────────────────────────────────────────
  const totalPosts = filtered.length;
  const totalImpressions = filtered.reduce(
    (s, p) => s + (p.analytics?.impressions ?? 0),
    0
  );
  const totalLikes = filtered.reduce(
    (s, p) => s + (p.analytics?.likes ?? 0),
    0
  );
  const avgEngagement =
    totalImpressions > 0
      ? ((totalLikes / totalImpressions) * 100).toFixed(2)
      : "0.00";

  const PLATFORM_FILTERS: { value: PlatformFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "twitter", label: "Twitter" },
    { value: "linkedin", label: "LinkedIn" },
    { value: "instagram", label: "Instagram" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Social Analytics"
        subtitle="Post performance across platforms"
        icon={<BarChart2 size={18} />}
        actions={
          <button
            onClick={loadPosts}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <RefreshCw size={10} />
            )}
            Refresh
          </button>
        }
      />

      {/* ── Summary Stat Cards ───────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {[
          { label: "Total Posts", value: totalPosts, color: "text-primary" },
          {
            label: "Total Impressions",
            value: fmtNum(totalImpressions),
            color: "text-cyan-400",
          },
          {
            label: "Total Likes",
            value: fmtNum(totalLikes),
            color: "text-pink-400",
          },
          {
            label: "Avg Engagement",
            value: `${avgEngagement}%`,
            color: "text-amber-400",
          },
        ].map((stat) => (
          <HudCard key={stat.label}>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">
              {stat.label}
            </p>
            <p className={`text-xl font-display font-bold ${stat.color}`}>
              {stat.value}
            </p>
          </HudCard>
        ))}
      </motion.div>

      {/* ── Filters + Sort ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Platform pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PLATFORM_FILTERS.map((pf) => (
            <button
              key={pf.value}
              onClick={() => setPlatformFilter(pf.value)}
              className={`px-3 py-1 text-[10px] font-mono rounded border transition-colors ${
                platformFilter === pf.value
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-muted/20 border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {pf.label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">
            Sort by
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-muted/30 border border-border rounded px-2 py-1 text-[10px] font-mono text-foreground focus:outline-none focus:border-primary/40"
          >
            <option value="date">Date</option>
            <option value="impressions">Impressions</option>
            <option value="likes">Likes</option>
          </select>
        </div>
      </div>

      {/* ── Posts List ──────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-primary" size={22} />
        </div>
      ) : sorted.length === 0 ? (
        <HudCard className="text-center py-10">
          <BarChart2 size={32} className="text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-mono text-muted-foreground">
            No posted content yet.
          </p>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            Posts with status "posted" will appear here.
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-2">
            Note: Analytics require Twitter Basic tier or higher.
          </p>
        </HudCard>
      ) : (
        <div className="space-y-2">
          {sorted.map((post, i) => {
            const a = post.analytics;
            const eng = a ? engagementRate(a.likes, a.impressions) : null;
            const platformStyle =
              PLATFORM_COLORS[post.platform] ?? PLATFORM_COLORS.other;

            return (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <HudCard>
                  <div className="flex items-start gap-3">
                    {/* Platform badge */}
                    <span
                      className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${platformStyle}`}
                    >
                      {post.platform}
                    </span>

                    {/* Content + date */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-foreground/90 leading-relaxed">
                        {post.content.length > 80
                          ? `${post.content.slice(0, 80)}…`
                          : post.content}
                      </p>
                      <span className="text-[9px] font-mono text-muted-foreground mt-0.5 block">
                        {fmtDate(post.created_at)}
                      </span>
                    </div>

                    {/* Metrics */}
                    {a ? (
                      <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                        <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                          <Eye size={10} className="text-cyan-400" />
                          <span>{fmtNum(a.impressions)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                          <Heart size={10} className="text-pink-400" />
                          <span>{fmtNum(a.likes)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                          <MessageCircle size={10} className="text-blue-400" />
                          <span>{fmtNum(a.replies_count)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                          <Repeat2 size={10} className="text-green-400" />
                          <span>{fmtNum(a.reposts)}</span>
                        </div>
                        {eng && (
                          <span className="text-[9px] font-mono text-amber-400">
                            {eng}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[9px] font-mono text-muted-foreground/50 border border-border/30 rounded px-1.5 py-0.5 shrink-0">
                        No data
                      </span>
                    )}
                  </div>
                </HudCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Info banner ─────────────────────────────────────────── */}
      {!loading && posts.some((p) => !p.analytics) && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded border border-amber-800/40 bg-amber-950/20">
          <span className="text-[10px] font-mono text-amber-400/80 leading-relaxed">
            Some posts have no analytics data. Twitter metrics require a Basic
            tier API subscription or higher.
          </span>
        </div>
      )}
    </div>
  );
}
