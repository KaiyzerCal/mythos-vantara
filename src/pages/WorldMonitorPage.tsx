import { useState, useEffect, useRef } from "react";
// @ts-ignore
import Globe from "react-globe.gl";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe as GlobeIcon, AlertTriangle, TrendingUp, TrendingDown,
  Brain, BarChart3, RefreshCw, ExternalLink, Loader2, X,
  Flame, Code, DollarSign, Activity, Zap, Radio, BookOpen,
} from "lucide-react";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const supabase: any = supabaseTyped;
const SB_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

type EventCategory = "earthquake" | "disaster" | "conflict" | "climate" | "aviation" | "maritime" | "news" | "market";

interface GlobeEvent {
  id: string; lat: number; lng: number;
  category: EventCategory; title: string; description?: string;
  severity: "low" | "medium" | "high" | "critical";
  magnitude?: number; url?: string; timestamp: string; color: string; size: number;
}
interface MarketTick {
  symbol: string; name: string; price: number; change24h: number;
  type: "index" | "crypto" | "commodity" | "forex"; marketCap?: number;
}
interface WorldBrief {
  headline: string; body: string;
  risk_level: "low" | "moderate" | "elevated" | "high" | "critical";
  key_themes: string[]; generated_at: string;
}
interface TechPulse {
  hn: { title: string; url: string; score: number; comments: number; by: string; time: number }[];
  github: { name: string; desc: string; lang: string; stars: string }[];
  bizNews: { title: string; url: string; domain: string; country: string }[];
  fetched_at: string;
}
interface FearGreed { value: number; label: string; timestamp: string; }

const CATEGORIES = [
  { id: "all",       label: "All",      color: "#a78bfa" },
  { id: "earthquake",label: "Seismic",  color: "#f97316" },
  { id: "disaster",  label: "Disaster", color: "#ef4444" },
  { id: "conflict",  label: "Conflict", color: "#dc2626" },
  { id: "climate",   label: "Climate",  color: "#3b82f6" },
  { id: "news",      label: "Intel",    color: "#eab308" },
  { id: "market",    label: "Markets",  color: "#22c55e" },
];

const RISK_BADGE: Record<string, string> = {
  low:      "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  moderate: "bg-amber-500/20  text-amber-400  border-amber-500/30",
  elevated: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  high:     "bg-red-500/20    text-red-400    border-red-500/30",
  critical: "bg-red-900/30   text-red-300   border-red-500/50",
};

const FEAR_GREED_COLOR = (v: number) =>
  v <= 25 ? "#ef4444" : v <= 45 ? "#f97316" : v <= 55 ? "#eab308" : v <= 75 ? "#84cc16" : "#22c55e";
const FEAR_GREED_LABEL = (v: number) =>
  v <= 25 ? "Extreme Fear" : v <= 45 ? "Fear" : v <= 55 ? "Neutral" : v <= 75 ? "Greed" : "Extreme Greed";

async function callWorldMonitor(action: string, params: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SB_URL}/functions/v1/mavis-worldmonitor`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) throw new Error(`worldmonitor ${action} failed: ${res.status}`);
  return res.json();
}

const CATEGORY_COLORS_MAP: Record<string, string> = {
  earthquake:"#f97316", disaster:"#ef4444", conflict:"#dc2626",
  climate:"#3b82f6", news:"#eab308", market:"#22c55e",
};
const LOCATION_KW: [string, [number,number]][] = [
  ["ukraine",[48.38,31.17]],["russia",[61.52,105.32]],["china",[35.86,104.19]],
  ["gaza",[31.35,34.31]],["israel",[31.05,34.85]],["iran",[32.43,53.69]],
  ["iraq",[33.22,43.68]],["syria",[34.80,38.99]],["yemen",[15.55,48.52]],
  ["north korea",[40.34,127.51]],["pakistan",[30.38,69.35]],["india",[20.59,78.96]],
  ["sudan",[15.55,32.53]],["ethiopia",[9.15,40.49]],["somalia",[5.15,46.20]],
  ["venezuela",[6.42,-66.59]],["turkey",[38.96,35.24]],["saudi",[23.89,45.08]],
  ["egypt",[26.82,30.80]],["nato",[50.85,4.35]],["myanmar",[21.91,95.96]],
  ["afghanistan",[33.93,67.71]],["lebanon",[33.85,35.86]],
];
function kwCoords(title: string): [number,number]|null {
  const l = title.toLowerCase();
  for (const [kw,c] of LOCATION_KW) if (l.includes(kw)) return c;
  return null;
}

// EONET (CORS-enabled) — fills Disaster + Climate when edge fn is old
async function fetchEonetFallback(): Promise<GlobeEvent[]> {
  try {
    const res = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30&days=14", { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    const out: GlobeEvent[] = [];
    for (const e of (data.events ?? [])) {
      const geo = e.geometries?.[0];
      if (!geo?.coordinates) continue;
      let lng: number, lat: number;
      if (geo.type === "Point") { [lng, lat] = geo.coordinates; }
      else if (geo.type === "Polygon") { const r = geo.coordinates[0]; [lng,lat] = Array.isArray(r[0]) ? r[0] : r; }
      else continue;
      if (isNaN(lng) || isNaN(lat)) continue;
      const ct = (e.categories?.[0]?.title ?? "").toLowerCase();
      const category: EventCategory = (ct.includes("storm") || ct.includes("drought") || ct.includes("temperature")) ? "climate" : "disaster";
      out.push({ id:`eonet-${e.id}`, lat, lng, category, title:e.title, description:e.categories?.[0]?.title, severity:"medium", url:e.sources?.[0]?.url, timestamp:geo.date??new Date().toISOString(), color:CATEGORY_COLORS_MAP[category], size:0.5 });
    }
    return out;
  } catch { return []; }
}

// GDELT (may fail CORS in browser — caught silently) — fills Conflict + Intel
async function fetchGdeltFallback(): Promise<GlobeEvent[]> {
  const FIPS: Record<string,[number,number]> = {
    US:[37.09,-95.71],UK:[55.38,-3.44],RS:[61.52,105.32],CH:[35.86,104.19],
    FR:[46.23,2.21],GM:[51.17,10.45],JA:[36.20,138.25],IN:[20.59,78.96],
    BR:[-14.24,-51.93],AU:[-25.27,133.78],UA:[48.38,31.17],IL:[31.05,34.85],
    IR:[32.43,53.69],IZ:[33.22,43.68],TR:[38.96,35.24],PK:[30.38,69.35],
    ET:[9.15,40.49],SO:[5.15,46.20],YE:[15.55,48.52],SY:[34.80,38.99],
    AF:[33.93,67.71],EG:[26.82,30.80],SA:[23.89,45.08],LE:[33.85,35.86],
    GZ:[31.35,34.31],WE:[31.95,35.23],SP:[40.46,-3.75],KS:[35.91,127.77],
  };
  function jitter() { return (Math.random()-0.5)*2; }
  function parseDate(s: string) {
    try { return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`; }
    catch { return new Date().toISOString(); }
  }
  const out: GlobeEvent[] = [];
  try {
    const [r1,r2] = await Promise.allSettled([
      fetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&query=conflict+war+military+strike+attack&maxrecords=20&sort=DateDesc&language=English", {signal:AbortSignal.timeout(12000)}),
      fetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&query=election+diplomacy+trade+economy+sanctions&maxrecords=15&sort=DateDesc&language=English", {signal:AbortSignal.timeout(12000)}),
    ]);
    for (const [r, cat, prefix] of [[r1,"conflict","gc"],[r2,"news","gn"]] as const) {
      if (r.status !== "fulfilled" || !r.value.ok) continue;
      const d = await r.value.json().catch(()=>null);
      for (const a of (d?.articles ?? [])) {
        const cc = (a.sourcecountry ?? "").toUpperCase();
        const coords = FIPS[cc] ?? kwCoords(a.title ?? "");
        if (!coords) continue;
        const [lat,lng] = coords;
        out.push({ id:`${prefix}-${encodeURIComponent((a.url??a.title??"x").slice(0,60))}`, lat:lat+jitter(), lng:lng+jitter(), category:cat as EventCategory, title:a.title, description:a.domain, severity:"medium", url:a.url, timestamp:a.seendate?parseDate(a.seendate):new Date().toISOString(), color:CATEGORY_COLORS_MAP[cat], size:0.5 });
      }
    }
  } catch { /* CORS may block — silent fallback */ }
  return out;
}

function relativeTime(iso: string | number) {
  const diff = Date.now() - (typeof iso === "number" ? iso : new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatPrice(price: number, type: string): string {
  if (!price && price !== 0) return "—";
  if (type === "crypto") {
    if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    if (price >= 1)    return `$${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
    return `$${price.toFixed(6)}`;
  }
  if (type === "forex") return price.toFixed(4);
  return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ── Fear & Greed Gauge ────────────────────────────────────────
function FearGreedGauge({ fg }: { fg: FearGreed }) {
  const color = FEAR_GREED_COLOR(fg.value);
  const label = FEAR_GREED_LABEL(fg.value);
  const angle = (fg.value / 100) * 180 - 90; // -90 to 90 deg
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <div className="relative w-28 h-14 overflow-hidden">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-28 h-28 rounded-full border-4" style={{ borderColor: "#222" }} />
        {/* Color arc segments */}
        {[["#ef4444",0,36],["#f97316",36,54],["#eab308",54,72],["#84cc16",72,90],["#22c55e",90,180]].map(([c,s,e]) => {
          const startA = ((s as number) / 180) * Math.PI;
          const endA   = ((e as number) / 180) * Math.PI;
          const r = 48;
          const cx = 56; const cy = 56;
          const x1 = cx + r * Math.cos(Math.PI + startA); const y1 = cy + r * Math.sin(Math.PI + startA);
          const x2 = cx + r * Math.cos(Math.PI + endA);   const y2 = cy + r * Math.sin(Math.PI + endA);
          return (
            <svg key={s as number} className="absolute inset-0" viewBox="0 0 112 56" style={{ overflow: "visible" }}>
              <path d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${(e as number)-(s as number)>90?1:0} 1 ${x2} ${y2} Z`} fill={c as string} opacity={0.7} />
            </svg>
          );
        })}
        {/* Needle */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0.5 origin-bottom h-12"
          style={{ transform: `translateX(-50%) rotate(${angle}deg)`, backgroundColor: "#fff", transformOrigin: "50% 100%" }} />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full -translate-y-0 bg-white" style={{ transform: "translate(-50%, 50%)" }} />
      </div>
      <div className="text-center">
        <div className="font-mono text-xl font-bold" style={{ color }}>{fg.value}</div>
        <div className="font-mono text-xs" style={{ color }}>{label}</div>
        <div className="text-zinc-600 text-[9px] font-mono">CRYPTO FEAR & GREED</div>
      </div>
    </div>
  );
}

// ── Market Tick Row ───────────────────────────────────────────
function TickRow({ t }: { t: MarketTick }) {
  const up = (t.change24h ?? 0) >= 0;
  return (
    <div className="flex items-center justify-between py-1 px-1 rounded hover:bg-zinc-800/40 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-xs text-zinc-400 w-14 shrink-0">{t.symbol}</span>
        <span className="text-[9px] text-zinc-600 truncate hidden sm:block">{t.name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono text-xs text-zinc-200">{formatPrice(t.price, t.type)}</span>
        <span className={`font-mono text-xs flex items-center gap-0.5 w-16 justify-end ${up ? "text-emerald-400" : "text-red-400"}`}>
          {up ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
          {t.change24h != null ? `${Math.abs(t.change24h).toFixed(2)}%` : "—"}
        </span>
      </div>
    </div>
  );
}

export default function WorldMonitorPage() {
  useAuth();
  const navigate = useNavigate();
  const globeRef    = useRef<any>();
  const containerRef= useRef<HTMLDivElement>(null);
  const [globeSize, setGlobeSize] = useState({ w: 600, h: 600 });

  const [events,      setEvents     ] = useState<GlobeEvent[]>([]);
  const [ticks,       setTicks      ] = useState<MarketTick[]>([]);
  const [brief,       setBrief      ] = useState<WorldBrief | null>(null);
  const [pulse,       setPulse      ] = useState<TechPulse | null>(null);
  const [fearGreed,   setFearGreed  ] = useState<FearGreed | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<GlobeEvent | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [marketTab,   setMarketTab  ] = useState<"indices" | "crypto" | "commodities" | "forex">("indices");
  const [loading,     setLoading    ] = useState(true);
  const [pulseLoading,setPulseLoading] = useState(false);

  const filteredEvents = activeCategory === "all" ? events : events.filter(e => e.category === activeCategory);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setGlobeSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.controls().autoRotate = true;
      globeRef.current.controls().autoRotateSpeed = 0.4;
      globeRef.current.controls().enableDamping = true;
      globeRef.current.pointOfView({ altitude: 2.5 }, 1000);
    }
  }, [events]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setPulseLoading(true);
    try {
      const [evRes, briefRes, mktRes, pulseRes] = await Promise.allSettled([
        callWorldMonitor("globe_events"),
        callWorldMonitor("news_brief"),
        callWorldMonitor("market_brief"),
        callWorldMonitor("tech_pulse"),
      ]);
      if (evRes.status    === "fulfilled") {
        const edgeEvents: GlobeEvent[] = evRes.value.events ?? [];
        setEvents(edgeEvents);
        // If edge fn is stale (only earthquakes), supplement with EONET public API
        // Note: GDELT is fetched server-side by mavis-worldmonitor; browser GDELT calls
        // fail due to CORS and are intentionally excluded here.
        const hasOtherCategories = edgeEvents.some(e => e.category !== "earthquake");
        if (!hasOtherCategories) {
          fetchEonetFallback().then(extra => {
            if (extra.length > 0) {
              setEvents(prev => {
                const existingIds = new Set(prev.map(e => e.id));
                return [...prev, ...extra.filter(e => !existingIds.has(e.id))];
              });
            }
          }).catch(() => { /* EONET unreachable — globe still shows edge data */ });
        }
      }
      if (briefRes.status === "fulfilled") setBrief(briefRes.value);
      if (mktRes.status   === "fulfilled") {
        setTicks(mktRes.value.ticks ?? []);
        if (mktRes.value.fearGreed) setFearGreed(mktRes.value.fearGreed);
      }
      if (pulseRes.status === "fulfilled") setPulse(pulseRes.value);
    } finally {
      setLoading(false);
      setPulseLoading(false);
    }
  }

  const indices     = ticks.filter(t => t.type === "index");
  const crypto      = ticks.filter(t => t.type === "crypto");
  const commodities = ticks.filter(t => t.type === "commodity");
  const forex       = ticks.filter(t => t.type === "forex");

  const highAlerts = filteredEvents.filter(e => e.severity === "high" || e.severity === "critical");

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/50 bg-zinc-950/60 shrink-0">
        <div className="flex items-center gap-3">
          <Radio size={15} className="text-violet-400" />
          <span className="font-semibold text-white font-mono text-sm tracking-widest">WORLD MONITOR</span>
          {loading
            ? <Loader2 size={12} className="animate-spin text-zinc-500" />
            : <span className="text-xs text-zinc-600 font-mono">{events.length} events</span>
          }
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 font-mono text-[10px] mr-3">
            <span className="text-zinc-500">SPX <span className="text-zinc-300">{ticks.find(t=>t.symbol==="SPX")?.price?.toFixed(0) ?? "—"}</span></span>
            <span className="text-zinc-500">BTC <span className="text-yellow-400">${(ticks.find(t=>t.symbol==="BTC")?.price ?? 0).toLocaleString(undefined,{maximumFractionDigits:0})}</span></span>
            <span className="text-zinc-500">VIX <span className="text-orange-400">{ticks.find(t=>t.symbol==="VIX")?.price?.toFixed(2) ?? "—"}</span></span>
            {fearGreed && <span style={{ color: FEAR_GREED_COLOR(fearGreed.value) }}>F&G {fearGreed.value}</span>}
          </div>
          <button onClick={loadAll} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => navigate("/mavis")} className="flex items-center gap-1 text-xs bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 px-3 py-1.5 rounded-lg transition-colors">
            <Brain size={12} /> Ask MAVIS
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-zinc-800/30 overflow-x-auto shrink-0">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-all whitespace-nowrap border ${
              activeCategory === cat.id ? "text-white" : "text-zinc-500 hover:text-zinc-300 border-transparent"
            }`}
            style={activeCategory === cat.id ? { backgroundColor: cat.color + "20", borderColor: cat.color + "60", color: cat.color } : {}}
          >
            <span style={{ backgroundColor: cat.color }} className="w-1.5 h-1.5 rounded-full" />
            {cat.label}
            {cat.id !== "all" && <span className="opacity-50">({events.filter(e => e.category === cat.id).length})</span>}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Globe */}
        <div ref={containerRef} className="relative flex-1 overflow-hidden min-w-0">
          <Globe
            ref={globeRef}
            width={globeSize.w}
            height={globeSize.h}
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            pointsData={filteredEvents}
            pointLat="lat" pointLng="lng" pointColor="color"
            pointAltitude={0.015} pointRadius="size"
            pointLabel={(d: any) => `
              <div style="background:#1e2035;border:1px solid #374151;border-radius:8px;padding:8px 12px;color:#f9fafb;font-size:12px;max-width:220px">
                <div style="font-weight:600;margin-bottom:4px">${d.title}</div>
                <div style="color:#9ca3af">${d.category} · ${d.severity}</div>
              </div>
            `}
            onPointClick={(point: any) => {
              setSelectedEvent(point as GlobeEvent);
              if (globeRef.current) globeRef.current.controls().autoRotate = false;
            }}
            onPointHover={(point: any) => { document.body.style.cursor = point ? "pointer" : "default"; }}
            atmosphereColor="#3b82f6" atmosphereAltitude={0.12}
          />

          {/* Globe event count overlay */}
          <div className="absolute top-3 left-3 font-mono text-[9px] text-zinc-500 space-y-0.5">
            {CATEGORIES.slice(1).map(cat => {
              const c = events.filter(e => e.category === cat.id).length;
              if (!c) return null;
              return (
                <div key={cat.id} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span style={{ color: cat.color }}>{cat.label}</span>
                  <span className="text-zinc-700">{c}</span>
                </div>
              );
            })}
          </div>

          {/* Selected event */}
          <AnimatePresence>
            {selectedEvent && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-4 left-4 right-4 bg-zinc-900/95 border border-zinc-700 rounded-xl p-4 backdrop-blur-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ backgroundColor: selectedEvent.color }} className="w-2 h-2 rounded-full shrink-0" />
                      <span className="text-xs text-zinc-400 uppercase">{selectedEvent.category}</span>
                      {selectedEvent.magnitude && <span className="text-xs text-orange-400 font-mono">M{selectedEvent.magnitude}</span>}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${RISK_BADGE[selectedEvent.severity]}`}>{selectedEvent.severity}</span>
                    </div>
                    <p className="text-sm font-medium text-white">{selectedEvent.title}</p>
                    {selectedEvent.description && <p className="text-xs text-zinc-500 mt-0.5">{selectedEvent.description}</p>}
                    <p className="text-xs text-zinc-600 mt-1">{relativeTime(selectedEvent.timestamp)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {selectedEvent.url && <a href={selectedEvent.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300"><ExternalLink size={14} /></a>}
                    <button onClick={() => { setSelectedEvent(null); if (globeRef.current) globeRef.current.controls().autoRotate = true; }} className="text-zinc-500 hover:text-zinc-300"><X size={14} /></button>
                  </div>
                </div>
                <button onClick={() => navigate(`/mavis?q=${encodeURIComponent("Tell me more about: " + selectedEvent.title)}`)}
                  className="mt-2 w-full text-xs bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 rounded-lg py-1.5 transition-colors">
                  Ask MAVIS about this →
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT PANEL — wide */}
        <div className="w-[400px] shrink-0 flex flex-col overflow-y-auto border-l border-zinc-800/50 bg-zinc-950/80 space-y-3 p-3">

          {/* ── Intelligence Brief ─────────────────────────── */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Brain size={13} className="text-violet-400" />
                <span className="text-xs font-medium text-zinc-300 tracking-wider">MAVIS INTEL BRIEF</span>
              </div>
              {brief && <span className={`text-[9px] px-2 py-0.5 rounded-full border font-mono ${RISK_BADGE[brief.risk_level]}`}>{brief.risk_level.toUpperCase()}</span>}
            </div>
            {!brief
              ? <div className="flex items-center gap-2 text-zinc-500 text-xs py-3"><Loader2 size={11} className="animate-spin" />MAVIS synthesizing…</div>
              : <>
                  <p className="text-xs font-semibold text-white mb-1.5">{brief.headline}</p>
                  <p className="text-[10px] text-zinc-400 leading-relaxed line-clamp-5">{brief.body}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {brief.key_themes.map(t => <span key={t} className="text-[9px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{t}</span>)}
                  </div>
                </>
            }
          </div>

          {/* ── Markets ─────────────────────────────────────── */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <BarChart3 size={13} className="text-emerald-400" />
                <span className="text-xs font-medium text-zinc-300 tracking-wider">LIVE MARKETS</span>
              </div>
              {fearGreed && <span className="text-[9px] font-mono px-2 py-0.5 rounded-full border" style={{ color: FEAR_GREED_COLOR(fearGreed.value), borderColor: FEAR_GREED_COLOR(fearGreed.value) + "50", backgroundColor: FEAR_GREED_COLOR(fearGreed.value) + "15" }}>F&G {fearGreed.value} · {fearGreed.label}</span>}
            </div>

            {/* Market tabs */}
            <div className="flex gap-1 mb-2">
              {(["indices","crypto","commodities","forex"] as const).map(tab => (
                <button key={tab} onClick={() => setMarketTab(tab)}
                  className={`text-[9px] font-mono px-2 py-0.5 rounded-full transition-colors ${marketTab === tab ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-zinc-600 hover:text-zinc-400"}`}>
                  {tab === "indices" ? "INDICES" : tab === "commodities" ? "COMMOD" : tab.toUpperCase()}
                </button>
              ))}
            </div>

            {ticks.length === 0
              ? <div className="flex items-center gap-2 text-zinc-500 text-[10px] py-2"><Loader2 size={11} className="animate-spin" />Fetching…</div>
              : <>
                  {marketTab === "indices" && indices.map(t => <TickRow key={t.symbol} t={t} />)}
                  {marketTab === "crypto"  && crypto.map(t  => <TickRow key={t.symbol} t={t} />)}
                  {marketTab === "commodities" && commodities.map(t => <TickRow key={t.symbol} t={t} />)}
                  {marketTab === "forex"   && forex.map(t   => <TickRow key={t.symbol} t={t} />)}
                  {marketTab === "crypto" && fearGreed && (
                    <div className="border-t border-zinc-800 mt-2 pt-2">
                      <FearGreedGauge fg={fearGreed} />
                    </div>
                  )}
                </>
            }
          </div>

          {/* ── Active Alerts ───────────────────────────────── */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-orange-400" />
                <span className="text-xs font-medium text-zinc-300 tracking-wider">ACTIVE ALERTS</span>
              </div>
              <span className="text-[9px] text-orange-400 font-mono">{highAlerts.length} HIGH+</span>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {highAlerts.slice(0, 12).map(e => (
                <button key={e.id} onClick={() => {
                  setSelectedEvent(e);
                  if (globeRef.current) { globeRef.current.pointOfView({ lat: e.lat, lng: e.lng, altitude: 1.5 }, 1000); globeRef.current.controls().autoRotate = false; }
                }} className="w-full text-left flex items-start gap-2 p-1.5 rounded hover:bg-zinc-800/50 transition-colors">
                  <span style={{ backgroundColor: e.color }} className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-zinc-300 line-clamp-1">{e.title}</p>
                    <p className="text-[9px] text-zinc-600">{e.category} · {relativeTime(e.timestamp)}</p>
                  </div>
                </button>
              ))}
              {highAlerts.length === 0 && <p className="text-[10px] text-zinc-600 py-1">No high-severity alerts</p>}
            </div>
          </div>

          {/* ── Hacker News ──────────────────────────────────── */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Flame size={13} className="text-orange-500" />
              <span className="text-xs font-medium text-zinc-300 tracking-wider">HACKER NEWS</span>
              {pulseLoading && <Loader2 size={10} className="animate-spin text-zinc-600 ml-auto" />}
            </div>
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {(pulse?.hn ?? []).slice(0, 12).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 p-1 rounded hover:bg-zinc-800/40 transition-colors group block">
                  <span className="text-[9px] text-zinc-600 font-mono w-5 text-right shrink-0 mt-0.5">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[10px] text-zinc-300 group-hover:text-white line-clamp-1 transition-colors">{s.title}</p>
                    <div className="flex gap-2 text-[8px] text-zinc-600 mt-0.5">
                      <span className="text-orange-500/70">▲ {s.score}</span>
                      <span>{s.comments} comments</span>
                      <span className="text-zinc-700">{relativeTime(s.time)}</span>
                    </div>
                  </div>
                </a>
              ))}
              {!pulse && !pulseLoading && <p className="text-[10px] text-zinc-600">No HN data</p>}
            </div>
          </div>

          {/* ── GitHub Trending ──────────────────────────────── */}
          {pulse?.github && pulse.github.length > 0 && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <Code size={13} className="text-green-400" />
                <span className="text-xs font-medium text-zinc-300 tracking-wider">GITHUB TRENDING</span>
              </div>
              <div className="space-y-1">
                {pulse.github.slice(0, 8).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 p-1 rounded hover:bg-zinc-800/30">
                    <span className="text-[9px] text-zinc-700 font-mono w-4">{i + 1}</span>
                    <span className="text-[10px] text-green-400 font-mono">{r.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Business / Startup News ──────────────────────── */}
          {pulse?.bizNews && pulse.bizNews.length > 0 && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={13} className="text-yellow-400" />
                <span className="text-xs font-medium text-zinc-300 tracking-wider">BUSINESS INTEL</span>
              </div>
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {pulse.bizNews.slice(0, 10).map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 p-1 rounded hover:bg-zinc-800/40 transition-colors block">
                    <p className="text-[10px] text-zinc-300 line-clamp-1">{n.title}</p>
                    <p className="text-[8px] text-zinc-600">{n.domain}</p>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ── Full Events Feed ─────────────────────────────── */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={13} className="text-zinc-400" />
              <span className="text-xs font-medium text-zinc-300 tracking-wider">ALL EVENTS FEED</span>
              <span className="text-[9px] text-zinc-600 ml-auto">{filteredEvents.length}</span>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {filteredEvents.slice(0, 40).map(e => (
                <button key={e.id} onClick={() => {
                  setSelectedEvent(e);
                  if (globeRef.current) { globeRef.current.pointOfView({ lat: e.lat, lng: e.lng, altitude: 1.8 }, 1000); globeRef.current.controls().autoRotate = false; }
                }} className="w-full text-left flex items-start gap-2 p-1.5 rounded hover:bg-zinc-800/40 transition-colors">
                  <span style={{ backgroundColor: e.color }} className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-zinc-300 line-clamp-1">{e.title}</p>
                    <p className="text-[8px] text-zinc-600">{e.category} · {relativeTime(e.timestamp)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
