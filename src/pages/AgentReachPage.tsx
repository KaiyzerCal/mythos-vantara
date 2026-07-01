// ============================================================
// VANTARA.EXE — AgentReachPage
// Internet Agent research dashboard — MAVIS multi-platform
// web access layer powered by Agent-Reach.
// Channels: Web (Jina), GitHub, Reddit, RSS, YouTube, Exa
// ============================================================

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe, Github, Radio, Search, Loader2, RefreshCw,
  ExternalLink, Copy, CheckCircle2, BookOpen, MessageSquare,
  Rss, Play, Brain, ChevronRight, AlertCircle, Zap,
  TrendingUp, Star, Code, FileText, Link, Database,
} from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

// ─── Constants ────────────────────────────────────────────────

const supabase: any = supabaseTyped;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

const PLATFORMS = [
  { id: "auto",    label: "Auto",    icon: Zap,         color: "#a78bfa", desc: "Detect from URL/query" },
  { id: "web",     label: "Web",     icon: Globe,       color: "#3b82f6", desc: "Jina Reader — any URL" },
  { id: "github",  label: "GitHub",  icon: Github,      color: "#6b7280", desc: "Repos, code, issues" },
  { id: "reddit",  label: "Reddit",  icon: MessageSquare, color: "#f97316", desc: "Search threads" },
  { id: "rss",     label: "RSS",     icon: Rss,         color: "#eab308", desc: "Any RSS/Atom feed" },
  { id: "youtube", label: "YouTube", icon: Play,        color: "#ef4444", desc: "Video info & transcript" },
  { id: "exa",     label: "Exa AI",  icon: Search,      color: "#8b5cf6", desc: "Semantic search" },
  { id: "multi",   label: "Multi",   icon: Database,    color: "#22c55e", desc: "Search all at once" },
] as const;

type PlatformId = typeof PLATFORMS[number]["id"];

const CHANNEL_HEALTH_LABELS: Record<string, string> = {
  web: "Web (Jina Reader)",
  github: "GitHub API",
  reddit: "Reddit JSON",
  rss: "RSS Reader",
  exa: "Exa Search",
};

// ─── Types ────────────────────────────────────────────────────

interface SearchResult {
  platform: string;
  type?: string;
  query?: string;
  url?: string;
  content?: string;
  length?: number;
  items?: any[];
  total?: number;
  title?: string;
  description?: string;
  repo?: string;
}

interface ChannelStatus {
  name: string;
  label: string;
  ok: boolean;
}

// ─── API helper ───────────────────────────────────────────────

async function callReach(action: string, params: Record<string, any> = {}): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SB_URL}/functions/v1/mavis-agent-reach`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Auto-detect platform ─────────────────────────────────────

function detectPlatform(input: string): { action: string; params: Record<string, any> } {
  const trimmed = input.trim();

  // GitHub URL: github.com/owner/repo or github.com/owner/repo/blob/...
  const ghMatch = trimmed.match(/github\.com\/([^/]+)\/([^/\s]+)(?:\/blob\/[^/]+\/(.+))?/);
  if (ghMatch) return { action: "github_read", params: { owner: ghMatch[1], repo: ghMatch[2], path: ghMatch[3] ?? "" } };

  // GitHub search query: starts with "github:"
  if (trimmed.startsWith("github:")) return { action: "github_search", params: { query: trimmed.slice(7).trim() } };

  // Reddit URL: reddit.com/...
  if (/reddit\.com/.test(trimmed)) return { action: "web_read", params: { url: trimmed } };

  // Reddit search: starts with "reddit:" or "r/"
  if (trimmed.startsWith("reddit:") || trimmed.startsWith("r/")) {
    const query = trimmed.startsWith("reddit:") ? trimmed.slice(7) : trimmed;
    const srMatch = query.match(/r\/([^\s/]+)\s+(.+)/);
    if (srMatch) return { action: "reddit_search", params: { subreddit: srMatch[1], query: srMatch[2] } };
    return { action: "reddit_search", params: { query: query.replace(/^r\//, "") } };
  }

  // YouTube URL
  if (/youtu\.be|youtube\.com/.test(trimmed)) return { action: "youtube_info", params: { url: trimmed } };

  // RSS/Atom feed URL (common patterns)
  if (/\/(feed|rss|atom)(\.xml)?(\?|$)/.test(trimmed) || trimmed.endsWith(".xml")) {
    return { action: "rss_read", params: { url: trimmed } };
  }

  // Any URL
  if (/^https?:\/\//.test(trimmed)) return { action: "web_read", params: { url: trimmed } };

  // Default: multi search
  return { action: "multi_search", params: { query: trimmed } };
}

// ─── Result sub-renderers ─────────────────────────────────────

function WebResult({ data }: { data: SearchResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Globe size={11} className="text-blue-400" />
        <a href={data.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate">{data.url}</a>
        <span>·</span>
        <span>{data.length?.toLocaleString()} chars</span>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 max-h-96 overflow-y-auto">
        <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{data.content?.slice(0, 8000)}</pre>
      </div>
    </div>
  );
}

function GithubReposResult({ data }: { data: SearchResult }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">{data.total?.toLocaleString()} repos found for &ldquo;{data.query}&rdquo;</p>
      {(data.items ?? []).map((item: any) => (
        <div key={item.name} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a href={item.url} target="_blank" rel="noreferrer"
                 className="text-sm font-medium text-blue-400 hover:underline">{item.name}</a>
              <p className="text-xs text-zinc-400 mt-1">{item.description}</p>
              <div className="flex items-center gap-3 mt-2">
                {item.language && <span className="text-xs text-zinc-500 flex items-center gap-1"><Code size={10} />{item.language}</span>}
                <span className="text-xs text-zinc-500 flex items-center gap-1"><Star size={10} />{item.stars?.toLocaleString()}</span>
                {item.topics?.slice(0, 3).map((t: string) => (
                  <span key={t} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            </div>
            <ExternalLink size={12} className="text-zinc-600 shrink-0 mt-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GithubFileResult({ data }: { data: SearchResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <FileText size={11} className="text-zinc-400" />
        <span className="font-mono">{data.repo} / {(data as any).path || "README"}</span>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 max-h-96 overflow-y-auto">
        <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{(data as any).content?.slice(0, 8000)}</pre>
      </div>
    </div>
  );
}

function RedditResult({ data }: { data: SearchResult }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">{data.items?.length} threads found for &ldquo;{data.query}&rdquo;</p>
      {(data.items ?? []).map((item: any, i: number) => (
        <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <a href={item.url} target="_blank" rel="noreferrer"
             className="text-sm font-medium text-orange-400 hover:underline line-clamp-2">{item.title}</a>
          <div className="flex items-center gap-3 mt-2 mb-2">
            <span className="text-xs text-zinc-500">r/{item.subreddit}</span>
            <span className="text-xs text-zinc-500 flex items-center gap-1"><TrendingUp size={10} />{item.score?.toLocaleString()}</span>
            <span className="text-xs text-zinc-500">{item.comments} comments</span>
          </div>
          {item.selftext && <p className="text-xs text-zinc-400 line-clamp-3">{item.selftext}</p>}
        </div>
      ))}
    </div>
  );
}

function RSSResult({ data }: { data: SearchResult }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300">{data.title}</p>
      {(data.items ?? []).map((item: any, i: number) => (
        <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <a href={item.link} target="_blank" rel="noreferrer"
             className="text-sm font-medium text-yellow-400 hover:underline line-clamp-1">{item.title}</a>
          {item.description && <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{item.description}</p>}
          {item.pubDate && <p className="text-xs text-zinc-600 mt-1">{item.pubDate}</p>}
        </div>
      ))}
    </div>
  );
}

function YouTubeResult({ data }: { data: SearchResult }) {
  const navigate = useNavigate();
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      {(data as any).thumbnail_url && (
        <img src={(data as any).thumbnail_url} alt={(data as any).title} className="w-full rounded-lg" />
      )}
      <p className="text-sm font-medium text-white">{(data as any).title ?? data.url}</p>
      <p className="text-xs text-zinc-400">{(data as any).author_name}</p>
      <div className="flex gap-2">
        <a href={data.url} target="_blank" rel="noreferrer"
           className="flex items-center gap-1 text-xs bg-red-600/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg hover:bg-red-600/30 transition-colors">
          <Play size={11} /> Watch
        </a>
        <button
          onClick={() => navigate(`/mavis?q=${encodeURIComponent("Analyze this YouTube video: " + data.url)}`)}
          className="flex items-center gap-1 text-xs bg-violet-600/20 text-violet-300 border border-violet-500/30 px-3 py-1.5 rounded-lg hover:bg-violet-600/30 transition-colors"
        >
          <Brain size={11} /> Analyze with MAVIS
        </button>
      </div>
    </div>
  );
}

function MultiResult({ data }: { data: SearchResult }) {
  const [expanded, setExpanded] = useState<string | null>("web");
  const sections = (data as any).results ?? {};

  return (
    <div className="space-y-3">
      {Object.entries(sections).map(([key, val]: [string, any]) => (
        <div key={key} className="border border-zinc-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === key ? null : key)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 transition-colors"
          >
            <span className="text-xs font-mono uppercase text-zinc-400">{key}</span>
            <ChevronRight
              size={13}
              className={`text-zinc-600 transition-transform ${expanded === key ? "rotate-90" : ""}`}
            />
          </button>
          {expanded === key && (
            <div className="bg-zinc-950 p-3 max-h-64 overflow-y-auto">
              <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono">
                {JSON.stringify(val, null, 2).slice(0, 4000)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ResultDisplay({ data }: { data: SearchResult }) {
  if (data.platform === "web") return <WebResult data={data} />;
  if (data.platform === "github" && data.type === "file") return <GithubFileResult data={data} />;
  if (data.platform === "github") return <GithubReposResult data={data} />;
  if (data.platform === "reddit") return <RedditResult data={data} />;
  if (data.platform === "rss") return <RSSResult data={data} />;
  if (data.platform === "youtube") return <YouTubeResult data={data} />;
  if (data.platform === "multi") return <MultiResult data={data} />;
  // Unknown: JSON preview
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 max-h-96 overflow-y-auto">
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────

export default function AgentReachPage() {
  useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<PlatformId>("auto");
  const [githubType, setGithubType] = useState<"repositories" | "code" | "issues">("repositories");
  const [subreddit, setSubreddit] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Search handler ──────────────────────────────────────────

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let action: string;
      let params: Record<string, any>;

      if (platform === "auto") {
        const detected = detectPlatform(query);
        action = detected.action;
        params = detected.params;
      } else if (platform === "web") {
        action = "web_read";
        params = { url: query };
      } else if (platform === "github") {
        const ghMatch = query.match(/github\.com\/([^/]+)\/([^/\s]+)/);
        if (ghMatch) {
          action = "github_read";
          params = { owner: ghMatch[1], repo: ghMatch[2] };
        } else {
          action = "github_search";
          params = { query, type: githubType };
        }
      } else if (platform === "reddit") {
        action = "reddit_search";
        params = { query, subreddit };
      } else if (platform === "rss") {
        action = "rss_read";
        params = { url: query };
      } else if (platform === "youtube") {
        action = "youtube_info";
        params = { url: query };
      } else if (platform === "exa") {
        action = "exa_search";
        params = { query };
      } else {
        action = "multi_search";
        params = { query };
      }

      const data = await callReach(action, params);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadChannelHealth() {
    setHealthLoading(true);
    try {
      const data = await callReach("channel_health");
      setChannels(data.channels ?? []);
    } catch { /* silently ignore */ }
    finally { setHealthLoading(false); }
  }

  useEffect(() => { loadChannelHealth(); }, []);

  function copyResult() {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function sendToMavis() {
    if (!result) return;
    const context = result.content
      ? result.content.slice(0, 2000)
      : JSON.stringify(result.items?.slice(0, 5) ?? result, null, 2).slice(0, 2000);
    navigate(`/mavis?q=${encodeURIComponent("Analyze this research data: " + context)}`);
  }

  // ── JSX ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-y-auto">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 shrink-0">
        <div className="flex items-center gap-3">
          <Search size={18} className="text-violet-400" />
          <span className="font-semibold text-white font-mono text-sm">INTERNET AGENT</span>
          <span className="text-xs text-zinc-600">powered by Agent-Reach</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadChannelHealth}
            className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw size={13} className={healthLoading ? "animate-spin" : ""} />
          </button>
          <a
            href="https://github.com/KaiyzerCal/Agent-Reach"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
          >
            <ExternalLink size={11} /> Agent-Reach
          </a>
        </div>
      </div>

      {/* Search bar + platform tabs */}
      <div className="px-4 py-4 space-y-3 border-b border-zinc-800/40 bg-zinc-950/60 shrink-0">

        {/* Platform selector */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PLATFORMS.map(p => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id as PlatformId)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                  platform === p.id
                    ? "border-opacity-50 text-white"
                    : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
                style={platform === p.id
                  ? { backgroundColor: p.color + "20", borderColor: p.color + "50", color: p.color }
                  : {}}
                title={p.desc}
              >
                <Icon size={11} /> {p.label}
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder={
                platform === "web"     ? "Paste a URL to read..." :
                platform === "github"  ? "Search repos or paste github.com/owner/repo..." :
                platform === "reddit"  ? "Search Reddit threads..." :
                platform === "rss"     ? "Paste RSS/Atom feed URL..." :
                platform === "youtube" ? "Paste YouTube video URL..." :
                platform === "exa"     ? "Semantic search query..." :
                "URL, search query, or github:/reddit:/rss: prefix..."
              }
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-violet-500 transition-colors font-body pr-10"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors shrink-0"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {loading ? "Fetching..." : "Fetch"}
          </button>
        </div>

        {/* GitHub sub-options */}
        {platform === "github" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Search type:</span>
            {(["repositories", "code", "issues"] as const).map(t => (
              <button
                key={t}
                onClick={() => setGithubType(t)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                  githubType === t
                    ? "bg-zinc-700 border-zinc-600 text-zinc-200"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Reddit sub-option: optional subreddit */}
        {platform === "reddit" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Subreddit (optional):</span>
            <input
              value={subreddit}
              onChange={e => setSubreddit(e.target.value)}
              placeholder="e.g. programming"
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1 text-xs text-white outline-none focus:border-violet-500 transition-colors w-40 font-mono"
            />
          </div>
        )}
      </div>

      {/* Result area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-300">
                {error === "Failed to fetch" || error.includes("NetworkError") ? "Edge function unreachable" : "Fetch failed"}
              </p>
              <p className="text-xs text-red-400/80 mt-1">{error}</p>
              {(error === "Failed to fetch" || error.includes("NetworkError")) && (
                <p className="text-xs text-zinc-500 mt-2">
                  The <code className="text-zinc-400">mavis-agent-reach</code> function may not be deployed yet.
                  Merge the branch to main to trigger the GitHub Actions deploy, or run:{" "}
                  <code className="text-zinc-400 block mt-1">supabase functions deploy mavis-agent-reach --project-ref YOUR_REF</code>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-zinc-400 uppercase">{result.platform}</span>
                {result.type && <span className="text-xs text-zinc-600">· {result.type}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={sendToMavis}
                  className="flex items-center gap-1 text-xs bg-violet-600/20 text-violet-300 border border-violet-500/30 px-2.5 py-1 rounded-lg hover:bg-violet-600/30 transition-colors"
                >
                  <Brain size={10} /> Ask MAVIS
                </button>
                <button
                  onClick={copyResult}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                >
                  {copied ? <CheckCircle2 size={10} className="text-emerald-400" /> : <Copy size={10} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <ResultDisplay data={result} />
          </div>
        )}

        {/* Empty state */}
        {!result && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-14 h-14 bg-violet-500/10 border border-violet-500/20 rounded-2xl flex items-center justify-center">
              <Search size={24} className="text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-300">Research anything</p>
              <p className="text-xs text-zinc-600 mt-1 max-w-xs">
                Enter a URL, search query, or use prefixes like{" "}
                <code className="text-zinc-400">github:</code>{" "}
                <code className="text-zinc-400">reddit:</code>{" "}
                <code className="text-zinc-400">rss:</code>
              </p>
            </div>
            {/* Quick action chips */}
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                { label: "GitHub trending", q: "github:trending AI", p: "github" as PlatformId },
                { label: "Reddit: AI news",  q: "AI agents",         p: "reddit" as PlatformId },
                { label: "HN RSS",           q: "https://news.ycombinator.com/rss", p: "rss" as PlatformId },
              ].map(chip => (
                <button
                  key={chip.label}
                  onClick={() => { setQuery(chip.q); setPlatform(chip.p); }}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-300 border border-zinc-700 px-3 py-1.5 rounded-full transition-colors"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer: channel health */}
      {channels.length > 0 && (
        <div className="border-t border-zinc-800/50 px-4 py-3 shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs text-zinc-600">Channels:</span>
            {channels.map(ch => (
              <div key={ch.name} className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${ch.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="text-xs text-zinc-500">{ch.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
