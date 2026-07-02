import { useRef, useEffect, useMemo, useCallback } from "react";
import { Type } from "lucide-react";

// ── Layout constants ────────────────────────────────────────────────────────
const RULER_H = 24;
const WAVE_H = 44;
const LANE_H = 30;
const LANE_GAP = 3;

// ── Format palette ──────────────────────────────────────────────────────────
const FMT_COLOR: Record<string, { bg: string; sel: string }> = {
  shorts:    { bg: "#6d28d9", sel: "#a78bfa" },
  reels:     { bg: "#be185d", sel: "#f472b6" },
  highlight: { bg: "#b45309", sel: "#fbbf24" },
  long_form: { bg: "#1d4ed8", sel: "#60a5fa" },
};

// ── Types ───────────────────────────────────────────────────────────────────
export interface TimelineClip {
  id?: string;
  start?: number; start_seconds?: number;
  end?: number;   end_seconds?: number;
  title?: string;
  viral_score?: number;
  format?: string;
  [k: string]: any;
}

export interface TimelineSegment {
  start_seconds: number;
  end_seconds: number;
  viral_score?: number;
}

export interface VideoTimelineProps {
  clips: TimelineClip[];
  segments: TimelineSegment[];
  duration: number;
  currentTime: number;
  selectedKeys: Set<string>;
  inPoint: number | null;
  outPoint: number | null;
  zoom: number; // px/sec
  clipKeyFn: (c: TimelineClip) => string;
  onSeek: (t: number) => void;
  onToggleClip: (key: string) => void;
  onAddOverlay: (key: string) => void;
}

// ── Greedy lane assignment ──────────────────────────────────────────────────
function assignLanes(clips: TimelineClip[], keyFn: (c: TimelineClip) => string) {
  const sorted = clips
    .map(c => ({
      key: keyFn(c),
      start: c.start ?? c.start_seconds ?? 0,
      end: c.end ?? c.end_seconds ?? 0,
    }))
    .sort((a, b) => a.start - b.start);

  const laneEnds: number[] = [];
  const map = new Map<string, number>();

  for (const { key, start, end } of sorted) {
    let lane = laneEnds.findIndex(e => e <= start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = end;
    map.set(key, lane);
  }

  return { map, count: Math.max(1, laneEnds.length) };
}

// ── Format time ─────────────────────────────────────────────────────────────
function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function VideoTimeline({
  clips, segments, duration, currentTime, selectedKeys,
  inPoint, outPoint, zoom, clipKeyFn,
  onSeek, onToggleClip, onAddOverlay,
}: VideoTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalW = Math.max(duration * zoom, 600);

  const { map: laneMap, count: numLanes } = useMemo(
    () => assignLanes(clips, clipKeyFn),
    [clips, clipKeyFn],
  );

  const totalH = RULER_H + WAVE_H + numLanes * (LANE_H + LANE_GAP) + 12;

  // Auto-scroll to keep playhead visible
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const px = currentTime * zoom;
    const { scrollLeft, clientWidth } = el;
    if (px < scrollLeft + 40 || px > scrollLeft + clientWidth - 80) {
      el.scrollTo({ left: Math.max(0, px - clientWidth / 2), behavior: "smooth" });
    }
  }, [currentTime, zoom]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    onSeek(Math.max(0, Math.min(duration, x / zoom)));
  }, [duration, zoom, onSeek]);

  // Ruler ticks
  const ticks = useMemo(() => {
    const minor = zoom >= 10 ? 5 : zoom >= 4 ? 10 : 30;
    const major = zoom >= 10 ? 30 : zoom >= 4 ? 60 : 120;
    const out: { t: number; major: boolean }[] = [];
    for (let t = 0; t <= duration; t += minor) {
      out.push({ t, major: t % major === 0 });
    }
    return out;
  }, [duration, zoom]);

  const playX = currentTime * zoom;

  return (
    <div
      ref={scrollRef}
      className="relative overflow-x-auto overflow-y-hidden select-none rounded-xl bg-[#0d0d10] border border-zinc-800/70"
      style={{ height: totalH }}
      onClick={handleClick}
    >
      <div className="relative" style={{ width: totalW, height: totalH }}>

        {/* ── Ruler ─────────────────────────────────────────────────────── */}
        <div className="absolute left-0 top-0 right-0" style={{ height: RULER_H }}>
          <div className="absolute inset-0 bg-zinc-900/80 border-b border-zinc-800" />
          {ticks.map(({ t, major }) => (
            <div
              key={t}
              className="absolute top-0 flex flex-col items-center pointer-events-none"
              style={{ left: t * zoom }}
            >
              <div
                className={major ? "w-px bg-zinc-500" : "w-px bg-zinc-700/60"}
                style={{ height: major ? 14 : 8, marginTop: major ? 0 : 6 }}
              />
              {major && (
                <span className="text-[9px] font-mono text-zinc-400 mt-0.5 whitespace-nowrap">
                  {fmt(t)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* ── Waveform (segment viral scores proxy) ─────────────────────── */}
        <div
          className="absolute left-0 right-0"
          style={{ top: RULER_H, height: WAVE_H }}
        >
          <div className="absolute inset-0 bg-zinc-900/40 border-b border-zinc-800/60" />
          {segments.map((seg, i) => {
            const score = seg.viral_score ?? 5;
            const h = Math.max(3, (score / 10) * (WAVE_H - 8));
            const x = seg.start_seconds * zoom;
            const w = Math.max(1, (seg.end_seconds - seg.start_seconds) * zoom - 1);
            const col =
              score >= 8 ? "#7c3aed99" :
              score >= 6 ? "#3b82f699" :
              "#27272a";
            return (
              <div
                key={i}
                className="absolute bottom-0 rounded-sm pointer-events-none"
                style={{ left: x, width: w, height: h, background: col }}
              />
            );
          })}
          {segments.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] text-zinc-700 font-mono">no waveform data</span>
            </div>
          )}
        </div>

        {/* ── Clip tracks ───────────────────────────────────────────────── */}
        {clips.map(clip => {
          const key = clipKeyFn(clip);
          const lane = laneMap.get(key) ?? 0;
          const start = clip.start ?? clip.start_seconds ?? 0;
          const end = clip.end ?? clip.end_seconds ?? 0;
          const x = start * zoom;
          const w = Math.max(3, (end - start) * zoom - 2);
          const y = RULER_H + WAVE_H + lane * (LANE_H + LANE_GAP) + 4;
          const fmt_ = clip.format ?? "shorts";
          const pal = FMT_COLOR[fmt_] ?? FMT_COLOR.shorts;
          const selected = selectedKeys.has(key);
          const score = clip.viral_score ?? 0;

          return (
            <div
              key={key}
              className="absolute rounded flex items-center overflow-hidden cursor-pointer"
              style={{
                left: x, top: y, width: w, height: LANE_H,
                background: selected ? pal.sel + "dd" : pal.bg + "cc",
                border: `1.5px solid ${selected ? pal.sel : pal.bg}`,
                outline: selected ? `1px solid ${pal.sel}` : undefined,
                zIndex: selected ? 2 : 1,
              }}
              onClick={e => { e.stopPropagation(); onToggleClip(key); }}
              title={`${clip.title ?? fmt_} · ${fmt(start)} → ${fmt(end)} · score ${score}`}
            >
              {w > 36 && (
                <span className="text-[9px] font-semibold text-white/90 px-1.5 truncate leading-none flex-1">
                  {w > 100 ? (clip.title?.slice(0, 28) ?? fmt_) : fmt_}
                </span>
              )}
              {w > 72 && (
                <span className="text-[9px] font-mono text-white/50 px-1 shrink-0">
                  {score > 0 ? score.toFixed(1) : ""}
                </span>
              )}
              {w > 88 && (
                <button
                  className="shrink-0 mr-1 text-white/50 hover:text-white transition-colors"
                  onClick={e => { e.stopPropagation(); onAddOverlay(key); }}
                  title="Add text overlay"
                >
                  <Type size={9} />
                </button>
              )}
            </div>
          );
        })}

        {/* ── In / Out markers ─────────────────────────────────────────── */}
        {inPoint !== null && outPoint !== null && (
          <div
            className="absolute top-0 bottom-0 bg-emerald-500/8 pointer-events-none"
            style={{ left: inPoint * zoom, width: (outPoint - inPoint) * zoom }}
          />
        )}
        {inPoint !== null && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: inPoint * zoom }}
          >
            <div className="w-0.5 h-full bg-emerald-400/80" />
            <div className="absolute top-5 left-0.5 text-[8px] font-mono text-emerald-400 whitespace-nowrap bg-zinc-900/80 px-0.5 rounded">
              IN {fmt(inPoint)}
            </div>
          </div>
        )}
        {outPoint !== null && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: outPoint * zoom }}
          >
            <div className="w-0.5 h-full bg-rose-400/80" />
            <div className="absolute top-5 left-0.5 text-[8px] font-mono text-rose-400 whitespace-nowrap bg-zinc-900/80 px-0.5 rounded">
              OUT {fmt(outPoint)}
            </div>
          </div>
        )}

        {/* ── Playhead ─────────────────────────────────────────────────── */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: playX, zIndex: 20 }}
        >
          <div className="w-0.5 h-full bg-white/70" />
          <div
            className="absolute top-0 -translate-x-1/2 w-2.5 h-2.5 bg-white rounded-full"
            style={{ left: 0 }}
          />
        </div>

        {/* ── Zero line ─────────────────────────────────────────────────── */}
        <div
          className="absolute top-0 bottom-0 w-px bg-zinc-700/50 pointer-events-none"
          style={{ left: 0 }}
        />
      </div>
    </div>
  );
}
