import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  TrendingUp, TrendingDown, RefreshCw, Plus, Trash2,
  ChevronRight, BarChart2, AlertCircle, Loader2, Zap,
  Activity, DollarSign, Globe, BookOpen, ExternalLink,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface QuoteData {
  code: string;
  name?: string;
  price?: number;
  change?: number;
  change_pct?: number;
  volume?: number;
  market_cap?: number;
  market?: string;
}

interface AnalysisResult {
  stock?: string;
  summary?: string;
  recommendation?: string;
  confidence?: number;
  target_price?: number;
  risk_level?: string;
  key_points?: string[];
  raw?: string;
}

interface DecisionSignal {
  code: string;
  name?: string;
  signal: "buy" | "sell" | "hold" | "watch";
  strength?: number;
  reason?: string;
  market?: string;
}

interface IntelBrief {
  summary?: string;
  highlights?: string[];
  sentiment?: string;
  updated_at?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function callStockAnalysis(action: string, params: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mavis-stock-analysis`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...params }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function SignalBadge({ signal }: { signal: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    buy:   { label: "BUY",   cls: "bg-green-500/15 text-green-400 border-green-500/30" },
    sell:  { label: "SELL",  cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    hold:  { label: "HOLD",  cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
    watch: { label: "WATCH", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  };
  const c = cfg[signal.toLowerCase()] ?? cfg.watch;
  return (
    <span className={`px-2 py-0.5 rounded border text-xs font-mono font-bold ${c.cls}`}>
      {c.label}
    </span>
  );
}

function ChangeDisplay({ change, pct }: { change?: number; pct?: number }) {
  if (change == null && pct == null) return <span className="text-muted-foreground">—</span>;
  const up = (pct ?? change ?? 0) >= 0;
  return (
    <span className={`flex items-center gap-1 text-xs font-mono ${up ? "text-green-400" : "text-red-400"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {pct != null ? `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%` : `${change! > 0 ? "+" : ""}${change!.toFixed(2)}`}
    </span>
  );
}

// ── Install CTA ────────────────────────────────────────────────────────────
function InstallCTA({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto">
          <BarChart2 size={28} className="text-primary" />
        </div>
        <h2 className="font-display text-primary text-lg font-bold tracking-widest">STOCK ANALYSIS ENGINE</h2>
        <p className="text-sm text-muted-foreground font-body">
          Connect to the daily_stock_analysis server to get AI-powered stock analysis across A-shares,
          HK, US, JP, and KR markets.
        </p>
        <div className="bg-muted/40 border border-border rounded p-4 text-left space-y-2">
          <p className="text-xs font-mono text-muted-foreground">Quick setup:</p>
          <code className="block text-xs font-mono text-primary/80 whitespace-pre-wrap">
            {`git clone https://github.com/KaiyzerCal/daily_stock_analysis\ncd daily_stock_analysis\npip install -r requirements.txt\nuvicorn main:app --port 8000`}
          </code>
        </div>
        <p className="text-xs text-muted-foreground">
          For cloud access, set <code className="text-primary/70">STOCK_ANALYSIS_URL</code> in Supabase secrets.
        </p>
        <div className="flex gap-3 justify-center">
          <a
            href="https://github.com/KaiyzerCal/daily_stock_analysis"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded border border-border text-sm text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
          >
            <ExternalLink size={14} /> View on GitHub
          </a>
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 rounded bg-primary/10 border border-primary/30 text-primary text-sm hover:bg-primary/20 transition-colors"
          >
            <RefreshCw size={14} /> Retry Connection
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Watchlist tab ──────────────────────────────────────────────────────────
function WatchlistTab() {
  const [watchlist, setWatchlist] = useState<QuoteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();

  const loadWatchlist = useCallback(async () => {
    try {
      const res = await callStockAnalysis("watchlist");
      const items: string[] = res.watchlist ?? res.stocks ?? [];
      if (!items.length) { setWatchlist([]); setLoading(false); return; }
      const quotes = await Promise.allSettled(
        items.map(code => callStockAnalysis("quote", { code }))
      );
      setWatchlist(
        quotes
          .map((r, i) => r.status === "fulfilled" ? (r.value as QuoteData) : { code: items[i] })
          .filter(Boolean)
      );
    } catch {
      setWatchlist([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadWatchlist(); }, [loadWatchlist]);

  const handleAdd = async () => {
    const code = addInput.trim().toUpperCase();
    if (!code) return;
    setAdding(true);
    try {
      await callStockAnalysis("watchlist_add", { code });
      setAddInput("");
      await loadWatchlist();
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (code: string) => {
    try {
      await callStockAnalysis("watchlist_remove", { code });
      setWatchlist(w => w.filter(s => s.code !== code));
    } catch (e) {
      console.error(e);
    }
  };

  const handleRefresh = () => { setRefreshing(true); loadWatchlist(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={addInput}
          onChange={e => setAddInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          placeholder="Add ticker (e.g. AAPL, 600519.SH)"
          className="flex-1 bg-muted/40 border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50"
        />
        <button
          onClick={handleAdd}
          disabled={adding || !addInput.trim()}
          className="px-3 py-2 rounded bg-primary/10 border border-primary/30 text-primary text-sm hover:bg-primary/20 transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-3 py-2 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={20} />
        </div>
      ) : watchlist.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Watchlist is empty. Add ticker symbols above.
        </div>
      ) : (
        <div className="space-y-2">
          {watchlist.map(stock => (
            <div
              key={stock.code}
              className="flex items-center gap-3 p-3 rounded border border-border bg-muted/20 hover:border-primary/20 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-bold text-foreground">{stock.code}</p>
                {stock.name && <p className="text-xs text-muted-foreground truncate">{stock.name}</p>}
              </div>
              {stock.price != null && (
                <div className="text-right">
                  <p className="font-mono text-sm font-bold">${stock.price.toFixed(2)}</p>
                  <ChangeDisplay change={stock.change} pct={stock.change_pct} />
                </div>
              )}
              <button
                onClick={() => navigate(`/mavis?q=Analyze ${stock.code} stock`)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground hover:text-primary transition-all"
                title="Ask MAVIS"
              >
                <ChevronRight size={14} />
              </button>
              <button
                onClick={() => handleRemove(stock.code)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground hover:text-destructive transition-all"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Analysis tab ───────────────────────────────────────────────────────────
function AnalysisTab() {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleAnalyze = async () => {
    const codes = input.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!codes.length) return;
    setRunning(true); setError(""); setResult(null);
    try {
      const res = await callStockAnalysis("analyze", { stocks: codes });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Enter stock codes (comma or space separated)&#10;e.g. AAPL MSFT, 600519.SH, 700.HK"
          rows={3}
          className="flex-1 bg-muted/40 border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/50 resize-none"
        />
        <button
          onClick={handleAnalyze}
          disabled={running || !input.trim()}
          className="px-4 py-2 rounded bg-primary/10 border border-primary/30 text-primary text-sm hover:bg-primary/20 transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          Run Analysis
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded border border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {running && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <Loader2 className="animate-spin text-primary" size={24} />
          <p className="text-sm font-mono">Running LLM analysis — this may take 30–90 seconds…</p>
        </div>
      )}

      {result && !running && (
        <div className="space-y-3">
          {/* Single stock result */}
          {result.summary && (
            <div className="p-4 rounded border border-primary/20 bg-primary/5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-mono font-bold text-primary text-sm">
                  {result.stock ?? "Analysis"}
                </h3>
                {result.recommendation && <SignalBadge signal={result.recommendation} />}
              </div>
              {result.confidence != null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">Confidence</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${result.confidence * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{Math.round(result.confidence * 100)}%</span>
                </div>
              )}
              {result.target_price != null && (
                <p className="text-xs text-muted-foreground font-mono">
                  Target: <span className="text-foreground">${result.target_price.toFixed(2)}</span>
                  {result.risk_level && (
                    <> · Risk: <span className="text-foreground">{result.risk_level}</span></>
                  )}
                </p>
              )}
              <p className="text-sm leading-relaxed">{result.summary}</p>
              {result.key_points && result.key_points.length > 0 && (
                <ul className="space-y-1">
                  {result.key_points.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="text-primary mt-0.5">·</span> {pt}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Raw/batch result fallback */}
          {!result.summary && result.raw && (
            <pre className="p-4 rounded border border-border bg-muted/20 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-96">
              {result.raw}
            </pre>
          )}

          {!result.summary && !result.raw && (
            <pre className="p-4 rounded border border-border bg-muted/20 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-96">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}

          <button
            onClick={() => navigate(`/mavis?q=Discuss this stock analysis: ${input}`)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <ChevronRight size={12} /> Discuss with MAVIS
          </button>
        </div>
      )}
    </div>
  );
}

// ── Decision Signals tab ───────────────────────────────────────────────────
function SignalsTab() {
  const [signals, setSignals] = useState<DecisionSignal[]>([]);
  const [market, setMarket] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const loadSignals = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await callStockAnalysis("decision_signals", { market: market === "all" ? undefined : market });
      const list: DecisionSignal[] = res.signals ?? res.data ?? [];
      setSignals(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => { loadSignals(); }, [loadSignals]);

  const MARKETS = ["all", "us", "hk", "cn", "jp", "kr"];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {MARKETS.map(m => (
          <button
            key={m}
            onClick={() => setMarket(m)}
            className={`px-3 py-1 rounded border text-xs font-mono uppercase transition-colors ${
              market === m
                ? "bg-primary/15 border-primary/40 text-primary"
                : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
            }`}
          >
            {m}
          </button>
        ))}
        <button onClick={loadSignals} className="ml-auto text-muted-foreground hover:text-primary transition-colors">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded border border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={20} />
        </div>
      ) : signals.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No signals available for {market === "all" ? "any market" : market.toUpperCase()}.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {signals.map((sig, i) => (
            <div
              key={`${sig.code}-${i}`}
              className="p-3 rounded border border-border bg-muted/20 hover:border-primary/20 transition-colors group cursor-pointer"
              onClick={() => navigate(`/mavis?q=Tell me about the ${sig.signal} signal for ${sig.code}`)}
            >
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="font-mono text-sm font-bold">{sig.code}</span>
                  {sig.name && <span className="ml-2 text-xs text-muted-foreground">{sig.name}</span>}
                </div>
                <SignalBadge signal={sig.signal} />
              </div>
              {sig.reason && <p className="text-xs text-muted-foreground line-clamp-2">{sig.reason}</p>}
              {sig.strength != null && (
                <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full ${sig.signal === "buy" ? "bg-green-500" : sig.signal === "sell" ? "bg-red-500" : "bg-yellow-500"}`}
                    style={{ width: `${sig.strength * 100}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Intelligence tab ───────────────────────────────────────────────────────
function IntelligenceTab() {
  const [brief, setBrief] = useState<IntelBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const loadBrief = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await callStockAnalysis("intelligence");
      setBrief(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBrief(); }, [loadBrief]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Market Intelligence Brief</h3>
        <button onClick={loadBrief} className="text-muted-foreground hover:text-primary transition-colors">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded border border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={20} />
        </div>
      ) : brief ? (
        <div className="space-y-4">
          {brief.sentiment && (
            <div className="flex items-center gap-2 p-3 rounded border border-border bg-muted/20">
              <Activity size={14} className="text-primary shrink-0" />
              <span className="text-xs font-mono text-muted-foreground">Sentiment:</span>
              <span className="text-xs font-mono text-foreground">{brief.sentiment}</span>
            </div>
          )}
          {brief.summary && (
            <div className="p-4 rounded border border-primary/20 bg-primary/5">
              <p className="text-sm leading-relaxed">{brief.summary}</p>
            </div>
          )}
          {brief.highlights && brief.highlights.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Key Highlights</p>
              <ul className="space-y-1.5">
                {brief.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-primary mt-1 shrink-0">·</span> {h}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {brief.updated_at && (
            <p className="text-xs text-muted-foreground font-mono">
              Updated: {new Date(brief.updated_at).toLocaleString()}
            </p>
          )}
          <button
            onClick={() => navigate("/mavis?q=Give me a detailed market intelligence briefing")}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <ChevronRight size={12} /> Deep-dive with MAVIS
          </button>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No intelligence brief available.
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
const TABS = [
  { id: "watchlist",    label: "Watchlist",    icon: DollarSign },
  { id: "analysis",    label: "AI Analysis",   icon: Zap },
  { id: "signals",     label: "Signals",       icon: Activity },
  { id: "intelligence",label: "Intelligence",  icon: Globe },
] as const;

type TabId = typeof TABS[number]["id"];

export default function StockAnalysisPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("watchlist");
  const [lastMarketReview, setLastMarketReview] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const navigate = useNavigate();
  const hasMounted = useRef(false);

  const checkConnection = useCallback(async () => {
    try {
      const res = await callStockAnalysis("health");
      setConnected(res.ok === true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    checkConnection();
  }, [checkConnection]);

  const handleMarketReview = async () => {
    setReviewLoading(true);
    try {
      const res = await callStockAnalysis("market_review");
      setLastMarketReview(res.report ?? res.summary ?? JSON.stringify(res, null, 2));
    } catch (e) {
      setLastMarketReview(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReviewLoading(false);
    }
  };

  if (connected === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  if (!connected) {
    return <InstallCTA onRetry={checkConnection} />;
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-primary font-bold tracking-widest text-sm">STOCK ANALYSIS ENGINE</h1>
          <p className="text-xs text-muted-foreground font-mono">LLM-powered analysis · A-shares · HK · US · JP · KR</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleMarketReview}
            disabled={reviewLoading}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
          >
            {reviewLoading ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />}
            Market Review
          </button>
          <button
            onClick={() => navigate("/mavis?q=Give me a stock market briefing")}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary text-xs hover:bg-primary/20 transition-colors"
          >
            <ChevronRight size={12} /> Ask MAVIS
          </button>
        </div>
      </div>

      {/* Market Review panel */}
      {lastMarketReview && (
        <div className="p-4 rounded border border-primary/20 bg-primary/5 relative">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-mono text-primary uppercase tracking-widest">Market Review</p>
            <button onClick={() => setLastMarketReview(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{lastMarketReview}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === "watchlist"     && <WatchlistTab />}
        {activeTab === "analysis"      && <AnalysisTab />}
        {activeTab === "signals"       && <SignalsTab />}
        {activeTab === "intelligence"  && <IntelligenceTab />}
      </div>
    </div>
  );
}
