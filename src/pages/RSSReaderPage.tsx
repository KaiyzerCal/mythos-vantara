// ============================================================
// VANTARA.EXE — RSSReaderPage
// Manage RSS/Atom feed subscriptions via mavis-rss-monitor
// View recently ingested articles saved to mavis_notes
// ============================================================
import { useState, useEffect, useCallback } from "react";
import {
  Rss, Plus, Trash2, Loader2, RefreshCw, ExternalLink,
  CheckCircle2, XCircle, AlertTriangle, Clock, Globe,
} from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader, HudCard } from "@/components/SharedUI";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";

const supabase: any = supabaseTyped;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

interface Feed {
  id: string;
  name: string;
  feed_url: string;
  enabled: boolean;
  last_fetched_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface Article {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source_url: string | null;
  created_at: string;
}

async function rssCall(token: string, body: object) {
  const res = await fetch(`${SB_URL}/functions/v1/mavis-rss-monitor`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RSSReaderPage() {
  const { user, session } = useAuth();
  const token = session?.access_token ?? "";

  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);

  const loadFeeds = useCallback(async () => {
    if (!token) return;
    setLoadingFeeds(true);
    try {
      const data = await rssCall(token, { action: "list_feeds" });
      setFeeds(data.feeds ?? []);
    } catch (e: any) {
      toast.error(`Failed to load feeds: ${e.message}`);
    } finally {
      setLoadingFeeds(false);
    }
  }, [token]);

  const loadArticles = useCallback(async () => {
    if (!user) return;
    setLoadingArticles(true);
    const { data } = await supabase
      .from("mavis_notes")
      .select("id, title, content, tags, source_url, created_at")
      .eq("user_id", user.id)
      .contains("tags", ["rss"])
      .order("created_at", { ascending: false })
      .limit(30);
    setArticles(data ?? []);
    setLoadingArticles(false);
  }, [user]);

  useEffect(() => { loadFeeds(); loadArticles(); }, [loadFeeds, loadArticles]);

  async function addFeed() {
    if (!addUrl.trim()) { toast.error("Feed URL required"); return; }
    setAdding(true);
    try {
      const url = addUrl.trim();
      const name = addName.trim() || new URL(url).hostname;
      await rssCall(token, { action: "add_feed", feed_url: url, name });
      toast.success(`Added feed: ${name}`);
      setAddUrl(""); setAddName(""); setShowAdd(false);
      loadFeeds();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function removeFeed(id: string) {
    try {
      await rssCall(token, { action: "remove_feed", id });
      setFeeds(f => f.filter(x => x.id !== id));
      toast.success("Feed removed");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function fetchFeed(feed: Feed) {
    setFetchingId(feed.id);
    try {
      const data = await rssCall(token, { action: "fetch", id: feed.id });
      toast.success(`${feed.name}: ${data.new_items ?? 0} new article(s)`);
      loadFeeds(); loadArticles();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setFetchingId(null);
    }
  }

  async function fetchAll() {
    setFetchingAll(true);
    try {
      // heartbeat calls fetch_all with service-role key; we call heartbeat directly
      const res = await fetch(`${SB_URL}/functions/v1/mavis-heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const data = await res.json().catch(() => ({}));
      toast.success(`Poll complete — ${data.rss_new_articles ?? 0} new article(s) across all feeds`);
      loadFeeds(); loadArticles();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setFetchingAll(false);
    }
  }

  const enabledCount = feeds.filter(f => f.enabled).length;
  const errorCount = feeds.filter(f => f.last_error).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="RSS Reader"
        subtitle="Proactive feed monitoring — articles saved automatically to your Vault"
        icon={<Rss size={18} />}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAll}
              disabled={fetchingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-zinc-800 border border-zinc-700 text-zinc-300 rounded hover:bg-zinc-700"
            >
              {fetchingAll ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Poll All
            </button>
            <button
              onClick={() => setShowAdd(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20"
            >
              <Plus size={12} /> Add Feed
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Feeds", value: feeds.length, color: "text-primary" },
          { label: "Active", value: enabledCount, color: "text-emerald-400" },
          { label: "Errors", value: errorCount, color: errorCount > 0 ? "text-red-400" : "text-zinc-500" },
          { label: "Articles Saved", value: articles.length, color: "text-cyan-400" },
        ].map(stat => (
          <HudCard key={stat.label}>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
            <p className={`text-2xl font-display font-bold ${stat.color}`}>{stat.value}</p>
          </HudCard>
        ))}
      </div>

      {showAdd && (
        <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-5 space-y-3">
          <p className="text-xs font-mono text-primary uppercase tracking-widest">Add RSS/Atom Feed</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Feed URL *</label>
              <input
                value={addUrl}
                onChange={e => setAddUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Name (optional)</label>
              <input
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="Hacker News"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-700">Cancel</button>
            <button onClick={addFeed} disabled={adding || !addUrl.trim()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/20 border border-primary/40 text-primary rounded-lg hover:bg-primary/30 disabled:opacity-50">
              {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add Feed
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Subscriptions ({feeds.length})</h2>
        {loadingFeeds ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-zinc-500" /></div>
        ) : feeds.length === 0 ? (
          <div className="text-center py-10">
            <Rss size={36} className="mx-auto mb-3 text-zinc-600" />
            <p className="text-sm text-zinc-500">No feeds yet. Add an RSS or Atom feed above.</p>
            <p className="text-xs text-zinc-600 mt-1">New articles are saved to your Vault automatically every 20 minutes.</p>
          </div>
        ) : feeds.map(feed => (
          <div key={feed.id} className="bg-zinc-900/60 border border-zinc-700/50 rounded-xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-center shrink-0 mt-0.5">
              <Rss size={14} className="text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-white">{feed.name}</p>
                  <p className="text-xs text-zinc-500 truncate max-w-xs">{feed.feed_url}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {feed.last_error
                    ? <XCircle size={13} className="text-red-400" />
                    : feed.last_fetched_at ? <CheckCircle2 size={13} className="text-emerald-400" /> : null
                  }
                  <button
                    onClick={() => fetchFeed(feed)}
                    disabled={fetchingId === feed.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-700 disabled:opacity-50"
                  >
                    {fetchingId === feed.id ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                    Fetch
                  </button>
                  <button
                    onClick={() => setConfirmDelete({ id: feed.id, name: feed.name })}
                    className="p-1.5 text-zinc-600 hover:text-red-400 rounded-lg"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1">
                {feed.last_fetched_at && (
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <Clock size={10} /> {timeAgo(feed.last_fetched_at)}
                  </span>
                )}
                {feed.last_error && (
                  <span className="flex items-center gap-1 text-xs text-red-400 truncate max-w-xs">
                    <AlertTriangle size={10} /> {feed.last_error}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Recent Articles ({articles.length})</h2>
        {loadingArticles ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-zinc-500" /></div>
        ) : articles.length === 0 ? (
          <div className="text-center py-8">
            <Globe size={32} className="mx-auto mb-2 text-zinc-600" />
            <p className="text-sm text-zinc-500">No articles ingested yet. Add feeds and trigger a poll.</p>
          </div>
        ) : articles.map(article => (
          <div key={article.id} className="bg-zinc-900/40 border border-zinc-700/30 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{article.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-zinc-500">{timeAgo(article.created_at)}</span>
                  {article.tags?.filter((t: string) => t !== "rss" && t !== "article").map((t: string) => (
                    <span key={t} className="text-xs px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400">{t}</span>
                  ))}
                </div>
                <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2">
                  {article.content.replace(/^#[^\n]+\n+/, "").replace(/\*\*[^*]+\*\*:/g, "").trim().slice(0, 200)}
                </p>
              </div>
              {article.source_url && (
                <a href={article.source_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-zinc-500 hover:text-zinc-300">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Remove Feed"
        description={`Remove "${confirmDelete?.name}" and stop ingesting new articles from it?`}
        onConfirm={() => { if (confirmDelete) { removeFeed(confirmDelete.id); setConfirmDelete(null); } }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
