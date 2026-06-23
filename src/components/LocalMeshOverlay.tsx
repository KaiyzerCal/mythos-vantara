/**
 * LocalMeshOverlay — Visual indicator that MAVIS is using local compute.
 *
 * Design concept:
 *   - Shimmering hexagonal grid overlays the interface (pointer-events:none)
 *   - Animated nodes pulse from the center outward during active computation
 *   - Each hex cell and node represents a local processing unit
 *   - Color: primary purple (#8B5CF6) matching MAVIS identity
 *   - Appears when localMesh.status === "online" and a request is in-flight
 *   - Subtle ambient animation when online but idle; stronger during active use
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type MeshActivity = "idle" | "active" | "offline";

interface LocalMeshOverlayProps {
  activity: MeshActivity;
  /** Where to show the overlay: "full" covers entire screen, "corner" is a small inset HUD */
  variant?: "full" | "corner";
}

// ── Hex geometry helpers ──────────────────────────────────────
const HEX_SIZE = 28; // px from center to vertex
const HEX_W    = HEX_SIZE * Math.sqrt(3);
const HEX_H    = HEX_SIZE * 2;

function hexPolygon(cx: number, cy: number, size: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`;
  }).join(" ");
}

function buildHexGrid(width: number, height: number) {
  const hexes: { cx: number; cy: number; key: string; dist: number }[] = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const cols = Math.ceil(width  / HEX_W) + 2;
  const rows = Math.ceil(height / HEX_H) + 2;

  for (let row = -rows; row <= rows; row++) {
    for (let col = -cols; col <= cols; col++) {
      const cx = col * HEX_W + (row % 2 === 0 ? 0 : HEX_W / 2) + centerX;
      const cy = row * (HEX_H * 0.75) + centerY;
      const dist = Math.sqrt((cx - centerX) ** 2 + (cy - centerY) ** 2);
      hexes.push({ cx, cy, key: `${row}-${col}`, dist });
    }
  }
  return hexes;
}

// ── Animated pulse nodes (ripple from center) ─────────────────
const PULSE_COUNT = 5;

function PulseRing({ delay, activity }: { delay: number; activity: MeshActivity }) {
  return (
    <motion.circle
      cx="50%"
      cy="50%"
      r={20}
      fill="none"
      stroke="rgba(139,92,246,0.6)"
      strokeWidth={1.5}
      initial={{ r: 20, opacity: 0.7 }}
      animate={
        activity === "active"
          ? { r: 220, opacity: 0, strokeWidth: 0.5 }
          : activity === "idle"
          ? { r: 80, opacity: 0 }
          : {}
      }
      transition={{
        duration: activity === "active" ? 1.8 : 3,
        delay,
        repeat: Infinity,
        repeatDelay: activity === "active" ? 0.3 : 1,
        ease: "easeOut",
      }}
    />
  );
}

// ── Corner HUD variant ────────────────────────────────────────
function CornerMeshHud({ activity }: { activity: MeshActivity }) {
  return (
    <div className="fixed bottom-20 right-4 z-40 pointer-events-none w-32 h-32">
      <svg width="128" height="128" className="opacity-70">
        {/* Small hex cluster */}
        {[
          { cx: 64, cy: 64 }, { cx: 90, cy: 50 }, { cx: 90, cy: 78 },
          { cx: 64, cy: 36 }, { cx: 38, cy: 50 }, { cx: 38, cy: 78 },
          { cx: 64, cy: 92 },
        ].map(({ cx, cy }, i) => (
          <motion.polygon
            key={i}
            points={hexPolygon(cx, cy, 18)}
            fill="rgba(139,92,246,0.06)"
            stroke="rgba(139,92,246,0.3)"
            strokeWidth={0.8}
            animate={activity === "active" ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.5 }}
            transition={{ duration: 1.5, delay: i * 0.15, repeat: Infinity }}
          />
        ))}

        {/* Pulse rings */}
        {activity !== "offline" &&
          Array.from({ length: 3 }, (_, i) => (
            <PulseRing key={i} delay={i * 0.5} activity={activity} />
          ))
        }

        {/* Center node */}
        <motion.circle
          cx={64} cy={64} r={5}
          fill="rgba(139,92,246,0.9)"
          animate={activity === "active" ? { scale: [1, 1.4, 1], opacity: [0.8, 1, 0.8] } : { scale: 1 }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      </svg>
    </div>
  );
}

// ── Full screen overlay ───────────────────────────────────────
function FullMeshOverlay({ activity }: { activity: MeshActivity }) {
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });
  const hexes = buildHexGrid(dims.w, dims.h);

  useEffect(() => {
    const handler = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return (
    <div className="fixed inset-0 z-30 pointer-events-none overflow-hidden">
      <svg width={dims.w} height={dims.h}>
        <defs>
          <radialGradient id="meshFade" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="rgba(139,92,246,0.12)" />
            <stop offset="60%"  stopColor="rgba(139,92,246,0.04)" />
            <stop offset="100%" stopColor="rgba(139,92,246,0)" />
          </radialGradient>
        </defs>

        {/* Background radial wash */}
        <rect width="100%" height="100%" fill="url(#meshFade)" />

        {/* Hex cells — fade by distance from center */}
        {hexes.map(({ cx, cy, key, dist }) => {
          const maxDist = Math.min(dims.w, dims.h) * 0.55;
          const proximity = Math.max(0, 1 - dist / maxDist);
          const baseOpacity = proximity * (activity === "active" ? 0.35 : 0.15);
          return (
            <motion.polygon
              key={key}
              points={hexPolygon(cx, cy, HEX_SIZE - 2)}
              fill={`rgba(139,92,246,${baseOpacity * 0.3})`}
              stroke={`rgba(139,92,246,${baseOpacity})`}
              strokeWidth={0.6}
              animate={
                activity === "active" && proximity > 0.5
                  ? { opacity: [baseOpacity, baseOpacity * 2.5, baseOpacity] }
                  : {}
              }
              transition={{
                duration: 1.2 + dist * 0.001,
                delay: (dist / maxDist) * 0.8,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          );
        })}

        {/* Ripple rings from center */}
        {Array.from({ length: PULSE_COUNT }, (_, i) => (
          <PulseRing key={i} delay={i * (activity === "active" ? 0.35 : 0.7)} activity={activity} />
        ))}

        {/* Interconnected node dots */}
        {hexes
          .filter(({ dist }) => dist < Math.min(dims.w, dims.h) * 0.4)
          .slice(0, 24)
          .map(({ cx, cy, key, dist }) => {
            const maxDist = Math.min(dims.w, dims.h) * 0.4;
            const proximity = Math.max(0, 1 - dist / maxDist);
            return (
              <motion.circle
                key={`node-${key}`}
                cx={cx} cy={cy} r={2}
                fill={`rgba(139,92,246,${proximity * 0.8})`}
                animate={
                  activity === "active"
                    ? { scale: [1, 1.8, 1], opacity: [proximity * 0.6, proximity, proximity * 0.6] }
                    : { scale: 1 }
                }
                transition={{
                  duration: 1.0 + dist * 0.002,
                  delay: (dist / maxDist) * 0.6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            );
          })}
      </svg>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────
export function LocalMeshOverlay({ activity, variant = "corner" }: LocalMeshOverlayProps) {
  return (
    <AnimatePresence>
      {activity !== "offline" && (
        <motion.div
          key="local-mesh"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
        >
          {variant === "full"
            ? <FullMeshOverlay activity={activity} />
            : <CornerMeshHud   activity={activity} />
          }
        </motion.div>
      )}
    </AnimatePresence>
  );
}
