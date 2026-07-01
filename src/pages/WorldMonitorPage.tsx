import { useState, useEffect, useRef } from "react";
// @ts-ignore
import Globe from "react-globe.gl";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe as GlobeIcon,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Brain,
  BarChart3,
  RefreshCw,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const supabase: any = supabaseTyped;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

type EventCategory =
  | "earthquake"
  | "disaster"
  | "conflict"
  | "climate"
  | "aviation"
  | "maritime"
  | "news"
  | "market";

interface GlobeEvent {
  id: string;
  lat: number;
  lng: number;
  category: EventCategory;
  title: string;
  description?: string;
  severity: "low" | "medium" | "high" | "critical";
  magnitude?: number;
  url?: string;
  timestamp: string;
  color: string;
  size: number;
}

interface MarketTick {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  type: "index" | "crypto" | "commodity";
}

interface WorldBrief {
  headline: string;
  body: string;
  risk_level: "low" | "moderate" | "elevated" | "high" | "critical";
  key_themes: string[];
  generated_at: string;
}

const CATEGORIES = [
  { id: "all", label: "All", color: "#a78bfa" },
  { id: "earthquake", label: "Seismic", color: "#f97316" },
  { id: "disaster", label: "Disaster", color: "#ef4444" },
  { id: "conflict", label: "Conflict", color: "#dc2626" },
  { id: "climate", label: "Climate", color: "#3b82f6" },
  { id: "news", label: "Intel", color: "#eab308" },
  { id: "market", label: "Markets", color: "#22c55e" },
];

const RISK_BADGE: Record<string, string> = {
  low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  moderate: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  elevated: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  critical: "bg-red-900/30 text-red-300 border-red-500/50",
};

async function callWorldMonitor(
  action: string,
  params: Record<string, any> = {}
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(`${SB_URL}/functions/v1/mavis-worldmonitor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok)
    throw new Error(`worldmonitor ${action} failed: ${res.status}`);
  return res.json();
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function WorldMonitorPage() {
  useAuth();
  const navigate = useNavigate();

  const globeRef = useRef<any>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [globeSize, setGlobeSize] = useState({ w: 600, h: 600 });

  const [events, setEvents] = useState<GlobeEvent[]>([]);
  const [ticks, setTicks] = useState<MarketTick[]>([]);
  const [brief, setBrief] = useState<WorldBrief | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<GlobeEvent | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [briefLoading, setBriefLoading] = useState(false);
  const [marketLoading, setMarketLoading] = useState(false);

  const filteredEvents =
    activeCategory === "all"
      ? events
      : events.filter((e) => e.category === activeCategory);

  // Resize observer for responsive globe
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setGlobeSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Auto-rotate after events load
  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.controls().autoRotate = true;
      globeRef.current.controls().autoRotateSpeed = 0.4;
      globeRef.current.controls().enableDamping = true;
      globeRef.current.pointOfView({ altitude: 2.5 }, 1000);
    }
  }, [events]);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setBriefLoading(true);
    setMarketLoading(true);
    try {
      const [evRes, briefRes, mktRes] = await Promise.allSettled([
        callWorldMonitor("globe_events"),
        callWorldMonitor("news_brief"),
        callWorldMonitor("market_brief"),
      ]);
      if (evRes.status === "fulfilled") setEvents(evRes.value.events ?? []);
      if (briefRes.status === "fulfilled") setBrief(briefRes.value);
      if (mktRes.status === "fulfilled") setTicks(mktRes.value.ticks ?? []);
    } finally {
      setLoading(false);
      setBriefLoading(false);
      setMarketLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 bg-zinc-950/50 shrink-0">
        <div className="flex items-center gap-3">
          <GlobeIcon size={18} className="text-violet-400" />
          <span className="font-semibold text-white font-mono text-sm">
            WORLD MONITOR
          </span>
          {loading && (
            <Loader2 size={12} className="animate-spin text-zinc-500" />
          )}
          {!loading && (
            <span className="text-xs text-zinc-600 font-mono">
              {events.length} events
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => navigate("/mavis")}
            className="flex items-center gap-1 text-xs bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Brain size={12} /> Ask MAVIS
          </button>
        </div>
      </div>

      {/* Category filter bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800/30 bg-zinc-950/30 overflow-x-auto shrink-0">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
              activeCategory === cat.id
                ? "text-white border"
                : "text-zinc-500 hover:text-zinc-300 border border-transparent"
            }`}
            style={
              activeCategory === cat.id
                ? {
                    backgroundColor: cat.color + "20",
                    borderColor: cat.color + "60",
                    color: cat.color,
                  }
                : {}
            }
          >
            <span
              style={{ backgroundColor: cat.color }}
              className="w-1.5 h-1.5 rounded-full"
            />
            {cat.label}
            {cat.id !== "all" && (
              <span className="text-xs opacity-60">
                ({events.filter((e) => e.category === cat.id).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Globe area */}
        <div
          ref={containerRef}
          className="relative flex-1 min-h-[400px] overflow-hidden"
        >
          <Globe
            ref={globeRef}
            width={globeSize.w}
            height={globeSize.h}
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            pointsData={filteredEvents}
            pointLat="lat"
            pointLng="lng"
            pointColor="color"
            pointAltitude={0.015}
            pointRadius="size"
            pointLabel={(d: any) => `
              <div style="background:#1e2035;border:1px solid #374151;border-radius:8px;padding:8px 12px;color:#f9fafb;font-size:12px;max-width:200px">
                <div style="font-weight:600;margin-bottom:4px">${d.title}</div>
                <div style="color:#9ca3af">${d.category} · ${d.severity}</div>
              </div>
            `}
            onPointClick={(point: any) => {
              setSelectedEvent(point as GlobeEvent);
              if (globeRef.current)
                globeRef.current.controls().autoRotate = false;
            }}
            onPointHover={(point: any) => {
              document.body.style.cursor = point ? "pointer" : "default";
            }}
            atmosphereColor="#3b82f6"
            atmosphereAltitude={0.12}
          />

          {/* Selected event overlay */}
          <AnimatePresence>
            {selectedEvent && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-4 left-4 right-4 bg-zinc-900/95 border border-zinc-700 rounded-xl p-4 backdrop-blur-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        style={{ backgroundColor: selectedEvent.color }}
                        className="w-2 h-2 rounded-full inline-block shrink-0"
                      />
                      <span className="text-xs text-zinc-400 uppercase">
                        {selectedEvent.category}
                      </span>
                      {selectedEvent.magnitude && (
                        <span className="text-xs text-orange-400 font-mono">
                          M{selectedEvent.magnitude}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-white">
                      {selectedEvent.title}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      {relativeTime(selectedEvent.timestamp)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {selectedEvent.url && (
                      <a
                        href={selectedEvent.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:text-blue-300"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button
                      onClick={() => {
                        setSelectedEvent(null);
                        if (globeRef.current)
                          globeRef.current.controls().autoRotate = true;
                      }}
                      className="text-zinc-500 hover:text-zinc-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() =>
                    navigate(
                      `/mavis?q=${encodeURIComponent(
                        "Tell me more about: " + selectedEvent.title
                      )}`
                    )
                  }
                  className="mt-3 w-full text-xs bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 rounded-lg py-1.5 px-3 transition-colors"
                >
                  Ask MAVIS about this →
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right panel */}
        <div className="w-full md:w-80 flex flex-col gap-3 p-3 overflow-y-auto border-l border-zinc-800/50 bg-zinc-950/80 shrink-0">
          {/* Intelligence Brief */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Brain size={14} className="text-violet-400" />
                <span className="text-xs font-medium text-zinc-300">
                  INTELLIGENCE BRIEF
                </span>
              </div>
              {brief && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border font-mono ${
                    RISK_BADGE[brief.risk_level]
                  }`}
                >
                  {brief.risk_level.toUpperCase()}
                </span>
              )}
            </div>
            {briefLoading ? (
              <div className="flex items-center gap-2 text-zinc-500 text-xs py-4">
                <Loader2 size={12} className="animate-spin" />
                MAVIS synthesizing...
              </div>
            ) : brief ? (
              <>
                <p className="text-sm font-semibold text-white mb-2">
                  {brief.headline}
                </p>
                <p className="text-xs text-zinc-400 leading-relaxed line-clamp-6">
                  {brief.body}
                </p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {brief.key_themes.map((t) => (
                    <span
                      key={t}
                      className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-zinc-500">Brief loading...</p>
            )}
          </div>

          {/* Market Snapshot */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={14} className="text-emerald-400" />
              <span className="text-xs font-medium text-zinc-300">
                MARKET SNAPSHOT
              </span>
            </div>
            {marketLoading ? (
              <div className="flex items-center gap-2 text-zinc-500 text-xs py-2">
                <Loader2 size={12} className="animate-spin" />
                Fetching...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {ticks.map((t) => (
                  <div key={t.symbol} className="bg-zinc-800/60 rounded-lg p-2">
                    <div className="text-xs text-zinc-500 font-mono">
                      {t.symbol}
                    </div>
                    <div className="text-sm font-mono text-white">
                      {t.type === "crypto"
                        ? `$${t.price.toLocaleString()}`
                        : t.price.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                    </div>
                    <div
                      className={`text-xs font-mono flex items-center gap-0.5 ${
                        t.change24h >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {t.change24h >= 0 ? (
                        <TrendingUp size={10} />
                      ) : (
                        <TrendingDown size={10} />
                      )}
                      {Math.abs(t.change24h).toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Alerts */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 flex-1 overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-orange-400" />
                <span className="text-xs font-medium text-zinc-300">
                  ACTIVE ALERTS
                </span>
              </div>
              <span className="text-xs text-zinc-600 font-mono">
                {
                  filteredEvents.filter(
                    (e) =>
                      e.severity === "high" || e.severity === "critical"
                  ).length
                }
              </span>
            </div>
            <div className="space-y-2 overflow-y-auto max-h-48">
              {filteredEvents
                .filter(
                  (e) =>
                    e.severity === "high" || e.severity === "critical"
                )
                .slice(0, 10)
                .map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setSelectedEvent(e);
                      if (globeRef.current) {
                        globeRef.current.pointOfView(
                          { lat: e.lat, lng: e.lng, altitude: 1.5 },
                          1000
                        );
                        globeRef.current.controls().autoRotate = false;
                      }
                    }}
                    className="w-full text-left flex items-start gap-2 p-2 rounded-lg hover:bg-zinc-800/60 transition-colors"
                  >
                    <span
                      style={{ backgroundColor: e.color }}
                      className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-300 line-clamp-1">
                        {e.title}
                      </p>
                      <p className="text-xs text-zinc-600">
                        {e.category} · {relativeTime(e.timestamp)}
                      </p>
                    </div>
                  </button>
                ))}
              {filteredEvents.filter(
                (e) => e.severity === "high" || e.severity === "critical"
              ).length === 0 && (
                <p className="text-xs text-zinc-600 py-2">
                  No high-severity alerts
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
