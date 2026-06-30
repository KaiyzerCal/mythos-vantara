// ============================================================
// VANTARA.EXE — FactoryPage (Canvas Edition)
// Factorio-style full-screen HTML5 Canvas factory floor.
// MAVIS AI ecosystem visualized as a Factorio production network.
// No React Flow. One <canvas>, requestAnimationFrame game loop.
// ============================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";

// ─── Canvas constants ─────────────────────────────────────────
const TILE = 48;
const FLOOR_COLOR = "#111208";
const GRID_COLOR = "#1c1c0f";
const BELT_COLOR = "#c8a800";
const BELT_DARK = "#8a7200";

// ─── Types ───────────────────────────────────────────────────

type MachineStatus = "active" | "warm" | "idle";

interface MachineEntry {
  id: string;
  name: string;
  role: string;
  status: MachineStatus;
}

interface MachineState {
  mavis: MachineStatus;
  memory: MachineStatus;
  ruview: MachineStatus;
  orders: MachineStatus;
  journal: MachineStatus;
  quest: MachineStatus;
  personas: MachineEntry[];
  councils: MachineEntry[];
  activeQuests: number;
  activeOrders: number;
}

interface BeltItem {
  x: number;
  y: number;
  targetPath: { x: number; y: number }[];
  pathIndex: number;
  color: string;
  speed: number;
  label: string;
  opacity: number;
  fading: boolean;
  fadeTimer: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

interface Worker {
  x: number;
  y: number;
  path: { x: number; y: number }[];
  pathIndex: number;
  speed: number;
  trail: { x: number; y: number; a: number }[];
}

// ─── Item colors ──────────────────────────────────────────────
const ITEM_COLORS: Record<string, string> = {
  memory: "#4488ff",
  journal: "#aa44ff",
  quest: "#ffaa00",
  ruview: "#00ffcc",
  order: "#ff8800",
  persona: "#44ff88",
  processed: "#ffffff",
};

// ─── Belt paths (pixel waypoints) ────────────────────────────
// Each source feeds down to the main belt row, then east to MAVIS (col 9, row 5)
// MAVIS center is around x=9.5*TILE, y=5.5*TILE
const MAVIS_ENTRY_X = 9 * TILE;
const MAVIS_ENTRY_Y = 5 * TILE;
const MAIN_BELT_Y = 5 * TILE + TILE / 2;

const BELT_PATHS: Record<string, { x: number; y: number }[]> = {
  memory: [
    { x: 1 * TILE + TILE / 2, y: 3 * TILE },
    { x: 1 * TILE + TILE / 2, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAVIS_ENTRY_Y },
  ],
  journal: [
    { x: 4 * TILE + TILE / 2, y: 3 * TILE },
    { x: 4 * TILE + TILE / 2, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAVIS_ENTRY_Y },
  ],
  quest: [
    { x: 7 * TILE + TILE / 2, y: 3 * TILE },
    { x: 7 * TILE + TILE / 2, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAVIS_ENTRY_Y },
  ],
  ruview: [
    { x: 10 * TILE + TILE / 2, y: 3 * TILE },
    { x: 10 * TILE + TILE / 2, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAVIS_ENTRY_Y },
  ],
  order: [
    { x: 13 * TILE + TILE / 2, y: 3 * TILE },
    { x: 13 * TILE + TILE / 2, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAVIS_ENTRY_Y },
  ],
  persona: [
    { x: 16 * TILE + TILE / 2, y: 3 * TILE },
    { x: 16 * TILE + TILE / 2, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAIN_BELT_Y },
    { x: MAVIS_ENTRY_X, y: MAVIS_ENTRY_Y },
  ],
};

// Output belt path (from MAVIS output going east)
const OUTPUT_BELT_START_X = 12 * TILE;
const OUTPUT_BELT_Y = 8 * TILE + TILE / 2;
const OUTPUT_PATH: { x: number; y: number }[] = [
  { x: OUTPUT_BELT_START_X, y: OUTPUT_BELT_Y },
  { x: 18 * TILE, y: OUTPUT_BELT_Y },
];

// ─── Resource patches ─────────────────────────────────────────
const RESOURCE_PATCHES = [
  { col: 0, row: 0, color: "#1a3a6b", label: "Memory" },
  { col: 3, row: 0, color: "#3b1a5c", label: "Journal" },
  { col: 6, row: 0, color: "#5c3a00", label: "Quest" },
  { col: 9, row: 0, color: "#004d4d", label: "RuView" },
  { col: 12, row: 0, color: "#4d3a00", label: "Orders" },
  { col: 15, row: 0, color: "#1a4d1a", label: "Persona" },
];

// ─── Drill positions (2×2, one per resource) ──────────────────
const DRILL_POSITIONS = [
  { col: 0, row: 1 },
  { col: 3, row: 1 },
  { col: 6, row: 1 },
  { col: 9, row: 1 },
  { col: 12, row: 1 },
  { col: 15, row: 1 },
];

// ─── Worker patrol paths ──────────────────────────────────────
const WORKER_PATHS = [
  [
    { x: 100, y: 400 },
    { x: 100, y: 580 },
    { x: 320, y: 580 },
    { x: 320, y: 400 },
  ],
  [
    { x: 900, y: 400 },
    { x: 900, y: 580 },
    { x: 700, y: 580 },
    { x: 700, y: 400 },
  ],
  [
    { x: 420, y: 340 },
    { x: 620, y: 340 },
    { x: 620, y: 500 },
    { x: 420, y: 500 },
  ],
];

// ─── Initial machine state ────────────────────────────────────
const INITIAL_MACHINE_STATE: MachineState = {
  mavis: "active",
  memory: "idle",
  ruview: "idle",
  orders: "idle",
  journal: "idle",
  quest: "idle",
  personas: [],
  councils: [],
  activeQuests: 0,
  activeOrders: 0,
};

// ─── Drawing helpers ──────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += TILE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += TILE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawResourcePatches(ctx: CanvasRenderingContext2D) {
  RESOURCE_PATCHES.forEach((p) => {
    const x = p.col * TILE;
    const y = p.row * TILE;
    // 2×2 tile patch
    ctx.fillStyle = p.color;
    ctx.fillRect(x + 2, y + 2, TILE * 2 - 4, TILE - 4);
    // Ore dots
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i < 6; i++) {
      const dx = 6 + (i % 3) * 20 + (i % 2 === 0 ? 5 : 0);
      const dy = 8 + Math.floor(i / 3) * 14;
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawBeltTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  beltOffset: number,
  horizontal = true
) {
  ctx.fillStyle = BELT_COLOR;
  ctx.fillRect(x, y, TILE, TILE);

  ctx.strokeStyle = BELT_DARK;
  ctx.lineWidth = 3;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, TILE, TILE);
  ctx.clip();

  if (horizontal) {
    // Horizontal belt: diagonal stripes going right
    for (let i = -TILE; i < TILE * 2; i += 14) {
      const off = ((beltOffset + i) % (TILE + 14)) - 14;
      ctx.beginPath();
      ctx.moveTo(x + off, y);
      ctx.lineTo(x + off + TILE, y + TILE);
      ctx.stroke();
    }
  } else {
    // Vertical belt: stripes going down
    for (let i = -TILE; i < TILE * 2; i += 14) {
      const off = ((beltOffset + i) % (TILE + 14)) - 14;
      ctx.beginPath();
      ctx.moveTo(x, y + off);
      ctx.lineTo(x + TILE, y + off + TILE);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Belt edge highlight
  ctx.strokeStyle = "rgba(255,200,0,0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, TILE, TILE);
}

function drawBelts(
  ctx: CanvasRenderingContext2D,
  beltOffset: number,
  canvasWidth: number
) {
  // Vertical feeder belts (rows 3-4)
  const FEEDER_COLS = [1, 4, 7, 10, 13, 16];
  FEEDER_COLS.forEach((col) => {
    for (let row = 3; row <= 4; row++) {
      drawBeltTile(ctx, col * TILE, row * TILE, beltOffset, false);
    }
  });

  // Main horizontal belt (row 5, full width)
  const cols = Math.ceil(canvasWidth / TILE) + 1;
  for (let col = 0; col < cols; col++) {
    drawBeltTile(ctx, col * TILE, 5 * TILE, beltOffset, true);
  }

  // Output belt (row 8)
  for (let col = 12; col < 19; col++) {
    drawBeltTile(ctx, col * TILE, 8 * TILE, beltOffset, true);
  }
}

function drawGear(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  teeth: number,
  rotation: number,
  color = "#888"
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  // Inner circle
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  // Spokes / teeth
  for (let i = 0; i < teeth; i++) {
    const angle = (i / teeth) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius * 0.4, Math.sin(angle) * radius * 0.4);
    ctx.lineTo(
      Math.cos(angle) * (radius + 4),
      Math.sin(angle) * (radius + 4)
    );
    ctx.stroke();
  }
  ctx.restore();
}

function getStatusBrightness(status: MachineStatus): number {
  if (status === "active") return 1.0;
  if (status === "warm") return 0.65;
  return 0.35;
}

function applyBrightness(
  ctx: CanvasRenderingContext2D,
  status: MachineStatus
) {
  const b = getStatusBrightness(status);
  ctx.globalAlpha = b;
}

function drawMiners(
  ctx: CanvasRenderingContext2D,
  frame: number,
  machineStates: MachineState
) {
  const patchKeys: Array<keyof MachineState> = [
    "memory",
    "journal",
    "quest",
    "ruview",
    "orders",
    "persona",
  ] as any;

  DRILL_POSITIONS.forEach((pos, i) => {
    const statusKey = patchKeys[i] ?? "idle";
    const status: MachineStatus =
      i < 5
        ? (machineStates[statusKey as keyof MachineState] as MachineStatus) ??
          "idle"
        : "active";
    const x = pos.col * TILE;
    const y = pos.row * TILE;
    const w = TILE * 2;
    const h = TILE * 2;
    const alpha = getStatusBrightness(status);

    ctx.globalAlpha = alpha;

    // Frame
    ctx.fillStyle = "#333";
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

    // Corner bolts
    ctx.fillStyle = "#666";
    [[x + 6, y + 6], [x + w - 10, y + 6], [x + 6, y + h - 10], [x + w - 10, y + h - 10]].forEach(([bx, by]) => {
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Piston (animated bob)
    const piston = status !== "idle" ? Math.sin(frame * 0.12 + i) * 5 : 0;
    const px = x + w / 2 - 5;
    const py = y + 6 + piston;
    ctx.fillStyle = "#777";
    ctx.fillRect(px, py, 10, h - 12);

    // Drill head
    ctx.fillStyle = status === "active" ? "#aaa" : "#555";
    ctx.fillRect(px - 4, py + h - 22, 18, 12);

    ctx.globalAlpha = 1;
  });
}

function drawMAVIS(
  ctx: CanvasRenderingContext2D,
  gearRotation: number,
  machineStates: MachineState,
  frame: number
) {
  const x = 8 * TILE;
  const y = 4 * TILE;
  const w = 3 * TILE;
  const h = 3 * TILE;
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Outer glow
  const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.8);
  glowGrad.addColorStop(0, "rgba(100,50,200,0.25)");
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(x - 20, y - 20, w + 40, h + 40);

  // Body
  ctx.fillStyle = "#130d2a";
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.strokeStyle = "#6b21d8";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

  // Corner accent lines
  ctx.strokeStyle = "#9b59f0";
  ctx.lineWidth = 1.5;
  const cs = 10;
  // TL
  ctx.beginPath(); ctx.moveTo(x + 2, y + 2 + cs); ctx.lineTo(x + 2, y + 2); ctx.lineTo(x + 2 + cs, y + 2); ctx.stroke();
  // TR
  ctx.beginPath(); ctx.moveTo(x + w - 2 - cs, y + 2); ctx.lineTo(x + w - 2, y + 2); ctx.lineTo(x + w - 2, y + 2 + cs); ctx.stroke();
  // BL
  ctx.beginPath(); ctx.moveTo(x + 2, y + h - 2 - cs); ctx.lineTo(x + 2, y + h - 2); ctx.lineTo(x + 2 + cs, y + h - 2); ctx.stroke();
  // BR
  ctx.beginPath(); ctx.moveTo(x + w - 2 - cs, y + h - 2); ctx.lineTo(x + w - 2, y + h - 2); ctx.lineTo(x + w - 2, y + h - 2 - cs); ctx.stroke();

  // Inner panel
  ctx.fillStyle = "#0d0921";
  ctx.fillRect(x + 10, y + 10, w - 20, h - 20);

  // Spinning gear
  const gearSpeed = machineStates.mavis === "active" ? 0.05 : machineStates.mavis === "warm" ? 0.015 : 0;
  drawGear(ctx, cx, cy, 28, 8, gearRotation * gearSpeed * 20, "#9b59f0");
  // Inner faster counter-rotating gear
  drawGear(ctx, cx, cy, 14, 6, -gearRotation * gearSpeed * 35, "#6b21d8");

  // Pulse ring when active
  if (machineStates.mavis === "active") {
    const pulseR = 32 + Math.sin(frame * 0.08) * 6;
    ctx.strokeStyle = `rgba(155,89,240,${0.3 + Math.sin(frame * 0.08) * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Label below
  ctx.fillStyle = "#9b59f0";
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center";
  ctx.fillText("MAVIS PRIME", cx, y + h + 14);
  ctx.fillStyle = "#6b21d8";
  ctx.font = "8px monospace";
  ctx.fillText("CORE SYSTEM", cx, y + h + 24);
}

function drawPersonaMachines(
  ctx: CanvasRenderingContext2D,
  personas: MachineEntry[],
  gearRotation: number
) {
  personas.forEach((p, i) => {
    const col = 0;
    const row = 9 + i * 3;
    const x = col * TILE;
    const y = row * TILE;
    const w = 2 * TILE;
    const h = 2 * TILE;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const alpha = getStatusBrightness(p.status);

    ctx.globalAlpha = alpha;

    ctx.fillStyle = "#061515";
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.strokeStyle = "#0d5c5c";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

    // Gear
    const gSpeed = p.status === "active" ? 0.03 : p.status === "warm" ? 0.008 : 0;
    drawGear(ctx, cx, cy, 16, 6, gearRotation * gSpeed * 20, "#1a8080");

    // Label
    ctx.fillStyle = "#1a8080";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    const labelText = p.name.length > 10 ? p.name.substring(0, 10) + "…" : p.name;
    ctx.fillText(labelText, cx, y + h + 12);

    ctx.globalAlpha = 1;
  });
}

function drawCouncilMachines(
  ctx: CanvasRenderingContext2D,
  councils: MachineEntry[],
  gearRotation: number,
  canvasWidth: number
) {
  councils.forEach((c, i) => {
    const x = canvasWidth - 2 * TILE - 8;
    const y = (9 + i * 3) * TILE;
    const w = 2 * TILE;
    const h = 2 * TILE;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const alpha = getStatusBrightness(c.status);

    ctx.globalAlpha = alpha;

    ctx.fillStyle = "#150a00";
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.strokeStyle = "#7a4a00";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

    // Flask/beaker shape inside
    ctx.strokeStyle = "#c87800";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 14);
    ctx.lineTo(cx - 6, cy - 4);
    ctx.lineTo(cx - 14, cy + 10);
    ctx.lineTo(cx + 14, cy + 10);
    ctx.lineTo(cx + 6, cy - 4);
    ctx.lineTo(cx + 6, cy - 14);
    ctx.closePath();
    ctx.stroke();
    // Liquid
    ctx.fillStyle = `rgba(200,120,0,0.3)`;
    ctx.fill();
    // Bubbles
    const bOff = (gearRotation * 0.5) % 1;
    ctx.fillStyle = "rgba(255,160,0,0.5)";
    ctx.beginPath();
    ctx.arc(cx - 4, cy + 4 - bOff * 8, 2, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = "#c87800";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    const labelText = c.name.length > 10 ? c.name.substring(0, 10) + "…" : c.name;
    ctx.fillText(labelText, cx, y + h + 12);

    ctx.globalAlpha = 1;
  });
}

function drawStorageChests(
  ctx: CanvasRenderingContext2D,
  machineStates: MachineState
) {
  const row = 9;
  const y = row * TILE;
  const fillLevel = Math.min(
    1,
    (machineStates.activeOrders + machineStates.activeQuests) / 20
  );

  for (let col = 13; col <= 18; col += 3) {
    const x = col * TILE;
    ctx.fillStyle = "#222";
    ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);

    // Fill level bar
    const barH = (TILE - 16) * fillLevel;
    ctx.fillStyle = "#c8a800";
    ctx.fillRect(x + 8, y + 4 + (TILE - 16) - barH, TILE - 16, barH);

    // Chest cross
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + TILE / 2, y + 8);
    ctx.lineTo(x + TILE / 2, y + TILE - 8);
    ctx.moveTo(x + 8, y + TILE / 2);
    ctx.lineTo(x + TILE - 8, y + TILE / 2);
    ctx.stroke();
  }
}

function drawInserters(
  ctx: CanvasRenderingContext2D,
  frame: number,
  machineStates: MachineState
) {
  const patchStatusKeys = [
    "memory",
    "journal",
    "quest",
    "ruview",
    "orders",
    "persona",
  ] as const;

  DRILL_POSITIONS.forEach((pos, i) => {
    const statusKey = patchStatusKeys[i];
    const status: MachineStatus =
      (machineStates[statusKey] as MachineStatus) ?? "idle";
    const isActive = status !== "idle";
    const pivotX = (pos.col + 1) * TILE + TILE / 2;
    const pivotY = (pos.row + 2) * TILE + TILE / 4;

    const armAngle =
      -Math.PI / 2 + Math.sin(frame * 0.08 + i * 1.2) * 0.7;
    const armLen = TILE * 1.2;
    const tipX = pivotX + Math.cos(armAngle) * armLen;
    const tipY = pivotY + Math.sin(armAngle) * armLen;

    ctx.strokeStyle = isActive ? "#aaa" : "#555";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Pivot
    ctx.fillStyle = isActive ? "#888" : "#444";
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Tip (holding item)
    if (isActive) {
      const itemColor = ITEM_COLORS[patchStatusKeys[i]] ?? "#888";
      ctx.fillStyle = itemColor;
      ctx.fillRect(tipX - 4, tipY - 4, 8, 8);
    } else {
      ctx.fillStyle = "#555";
      ctx.beginPath();
      ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function updateAndDrawItems(
  ctx: CanvasRenderingContext2D,
  items: BeltItem[]
): void {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];

    if (item.fading) {
      item.opacity -= 0.025;
      if (item.opacity <= 0) {
        items.splice(i, 1);
        continue;
      }
    } else if (item.pathIndex < item.targetPath.length) {
      const target = item.targetPath[item.pathIndex];
      const dx = target.x - item.x;
      const dy = target.y - item.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < item.speed) {
        item.x = target.x;
        item.y = target.y;
        item.pathIndex++;
      } else {
        item.x += (dx / dist) * item.speed;
        item.y += (dy / dist) * item.speed;
      }
    } else {
      // Reached end — start fading
      item.fading = true;
    }

    // Draw
    ctx.globalAlpha = item.opacity;
    ctx.fillStyle = item.color;
    ctx.fillRect(item.x - 5, item.y - 5, 10, 10);
    // Glow
    ctx.shadowColor = item.color;
    ctx.shadowBlur = 6;
    ctx.fillRect(item.x - 5, item.y - 5, 10, 10);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  machineStates: MachineState,
  frame: number
): void {
  // Spawn from MAVIS when active
  if (machineStates.mavis === "active" && frame % 25 === 0) {
    const cx = 8 * TILE + 1.5 * TILE;
    const cy = 4 * TILE;
    for (let k = 0; k < 2; k++) {
      particles.push({
        x: cx + (Math.random() - 0.5) * 20,
        y: cy,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.9 - Math.random() * 0.4,
        life: 1,
        size: 4 + Math.random() * 4,
      });
    }
  }

  // Spawn from active drills
  DRILL_POSITIONS.forEach((pos, i) => {
    const patchStatusKeys = ["memory", "journal", "quest", "ruview", "orders", "persona"] as const;
    const status: MachineStatus = (machineStates[patchStatusKeys[i]] as MachineStatus) ?? "idle";
    if (status === "active" && frame % 35 === i * 5 % 35) {
      particles.push({
        x: pos.col * TILE + TILE,
        y: pos.row * TILE,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.6,
        life: 0.7,
        size: 3 + Math.random() * 2,
      });
    }
  });

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.99;
    p.life -= 0.012;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = p.life * 0.5;
    ctx.fillStyle = "#666";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - p.life * 0.3), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function updateAndDrawWorkers(
  ctx: CanvasRenderingContext2D,
  workers: Worker[]
): void {
  workers.forEach((w) => {
    const target = w.path[w.pathIndex % w.path.length];
    const dx = target.x - w.x;
    const dy = target.y - w.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < w.speed) {
      w.x = target.x;
      w.y = target.y;
      w.pathIndex = (w.pathIndex + 1) % w.path.length;
    } else {
      w.x += (dx / dist) * w.speed;
      w.y += (dy / dist) * w.speed;
    }

    // Trail
    w.trail.push({ x: w.x, y: w.y, a: 0.35 });
    if (w.trail.length > 20) w.trail.shift();

    w.trail.forEach((t, i) => {
      const alpha = (i / w.trail.length) * t.a;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#c8a030";
      ctx.beginPath();
      ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Worker body
    ctx.fillStyle = "#e8d080";
    ctx.beginPath();
    ctx.arc(w.x, w.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#a09050";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Direction dot
    ctx.fillStyle = "#fff";
    const dotAngle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.arc(w.x + Math.cos(dotAngle) * 3, w.y + Math.sin(dotAngle) * 3, 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  machineStates: MachineState
) {
  ctx.textAlign = "center";
  ctx.font = "8px monospace";

  // Resource patch labels
  RESOURCE_PATCHES.forEach((p) => {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(p.label.toUpperCase(), p.col * TILE + TILE, p.row * TILE - 4);
  });

  // Status labels on drills
  const patchKeys = ["memory", "journal", "quest", "ruview", "orders", "persona"] as const;
  DRILL_POSITIONS.forEach((pos, i) => {
    const status: MachineStatus = (machineStates[patchKeys[i]] as MachineStatus) ?? "idle";
    const color =
      status === "active" ? "#44ff44" : status === "warm" ? "#ffcc00" : "#555";
    ctx.fillStyle = color;
    ctx.fillText("●", pos.col * TILE + TILE, pos.row * TILE - 2);
  });
}

// ─── FactoryPage component ────────────────────────────────────

export default function FactoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Refs for animation (no re-renders) ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const beltOffsetRef = useRef(0);
  const gearRotationRef = useRef(0);
  const frameRef = useRef(0);
  const itemsRef = useRef<BeltItem[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const workersRef = useRef<Worker[]>([]);
  const machineStatesRef = useRef<MachineState>(INITIAL_MACHINE_STATE);

  // ── State for HUD (re-renders allowed) ──
  const [machineStates, setMachineStates] = useState<MachineState>(INITIAL_MACHINE_STATE);
  const [loading, setLoading] = useState(false);

  // Derived HUD counts
  const allStatuses: MachineStatus[] = [
    machineStates.mavis,
    machineStates.memory,
    machineStates.ruview,
    machineStates.orders,
    machineStates.journal,
    machineStates.quest,
    ...machineStates.personas.map((p) => p.status),
    ...machineStates.councils.map((c) => c.status),
  ];
  const activeCount = allStatuses.filter((s) => s === "active").length;
  const warmCount = allStatuses.filter((s) => s === "warm").length;
  const idleCount = allStatuses.filter((s) => s === "idle").length;

  // Items per minute estimate (rough)
  const [itemsPerMin, setItemsPerMin] = useState(0);

  // ── Spawn belt item ──
  const spawnItem = useCallback((type: keyof typeof BELT_PATHS) => {
    const path = BELT_PATHS[type];
    if (!path) return;
    itemsRef.current.push({
      x: path[0].x,
      y: path[0].y,
      targetPath: path,
      pathIndex: 1,
      color: ITEM_COLORS[type] ?? "#888",
      speed: 1.2 + Math.random() * 0.4,
      label: type,
      opacity: 1,
      fading: false,
      fadeTimer: 0,
    });
  }, []);

  // ── Load factory state from DB ──
  const loadFactoryState = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const now = new Date();

      const [personasRes, councilsRes, memoriesRes, ordersRes, ruviewRes, questsRes] =
        await Promise.all([
          (supabase as any)
            .from("personas")
            .select("id,name,role,updated_at")
            .eq("user_id", user.id)
            .limit(6),
          (supabase as any)
            .from("councils")
            .select("id,name,role,specialty,updated_at")
            .eq("user_id", user.id)
            .limit(6),
          (supabase as any)
            .from("mavis_agent_memories")
            .select("created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1),
          (supabase as any)
            .from("standing_order_templates")
            .select("id")
            .eq("user_id", user.id)
            .in("status", ["active", "pinned"]),
          (supabase as any)
            .from("mavis_ruview_state")
            .select("updated_at,present,heart_rate_bpm")
            .eq("user_id", user.id)
            .maybeSingle(),
          (supabase as any)
            .from("quests")
            .select("id")
            .eq("user_id", user.id)
            .eq("status", "active")
            .limit(10),
        ]);

      const getStatus = (dateStr?: string | null): MachineStatus => {
        if (!dateStr) return "idle";
        const d = new Date(dateStr).getTime();
        const diff = now.getTime() - d;
        if (diff < 3_600_000) return "active";
        if (diff < 86_400_000) return "warm";
        return "idle";
      };

      const nextState: MachineState = {
        mavis: "active",
        memory: getStatus(memoriesRes.data?.[0]?.created_at),
        ruview: ruviewRes.data ? getStatus(ruviewRes.data.updated_at) : "idle",
        orders: (ordersRes.data?.length ?? 0) > 0 ? "active" : "idle",
        journal: "warm", // journals are always somewhat warm
        quest: (questsRes.data?.length ?? 0) > 0 ? "active" : "idle",
        personas: (personasRes.data ?? []).map(
          (p: { id: string; name: string; role: string; updated_at?: string }) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            status: getStatus(p.updated_at),
          })
        ),
        councils: (councilsRes.data ?? []).map(
          (c: { id: string; name: string; role?: string; specialty?: string; updated_at?: string }) => ({
            id: c.id,
            name: c.name,
            role: c.specialty ?? c.role ?? "",
            status: getStatus(c.updated_at),
          })
        ),
        activeQuests: questsRes.data?.length ?? 0,
        activeOrders: ordersRes.data?.length ?? 0,
      };

      // Update ref immediately (used by animation loop)
      machineStatesRef.current = nextState;
      // Update state for HUD re-render
      setMachineStates(nextState);

      // Estimate items/min from active sources
      const activeSources = [
        nextState.memory,
        nextState.ruview,
        nextState.orders,
        nextState.quest,
        nextState.journal,
      ].filter((s) => s === "active").length;
      setItemsPerMin(activeSources * 5);

      // Spawn items for active sources
      if (nextState.memory === "active") spawnItem("memory");
      if (nextState.ruview === "active") spawnItem("ruview");
      if (nextState.orders === "active") spawnItem("order");
      if (nextState.quest === "active") spawnItem("quest");
      if (nextState.journal !== "idle") spawnItem("journal");
      if ((personasRes.data?.length ?? 0) > 0) spawnItem("persona");
    } catch (err) {
      console.error("[FactoryPage] DB error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, spawnItem]);

  // ── Canvas resize ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ── Initialize workers ──
  useEffect(() => {
    workersRef.current = WORKER_PATHS.map((path) => ({
      x: path[0].x,
      y: path[0].y,
      path,
      pathIndex: 1,
      speed: 1.1 + Math.random() * 0.3,
      trail: [],
    }));
  }, []);

  // ── Spawn initial items so belts look active from start ──
  useEffect(() => {
    spawnItem("memory");
    spawnItem("journal");
    spawnItem("quest");
  }, [spawnItem]);

  // ── Game loop ──
  const gameLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const states = machineStatesRef.current;

    // Clear
    ctx.fillStyle = FLOOR_COLOR;
    ctx.fillRect(0, 0, W, H);

    // Grid
    drawGrid(ctx, W, H);

    // Resource patches
    drawResourcePatches(ctx);

    // Belts (must happen before machines so machines draw on top)
    drawBelts(ctx, beltOffsetRef.current, W);
    beltOffsetRef.current = (beltOffsetRef.current + 0.45) % TILE;

    // Miners (drills)
    drawMiners(ctx, frameRef.current, states);

    // Inserter arms
    drawInserters(ctx, frameRef.current, states);

    // MAVIS central machine
    drawMAVIS(ctx, gearRotationRef.current, states, frameRef.current);
    gearRotationRef.current += 1;

    // Persona machines (left side, below main area)
    drawPersonaMachines(ctx, states.personas, gearRotationRef.current);

    // Council machines (right side)
    drawCouncilMachines(ctx, states.councils, gearRotationRef.current, W);

    // Storage chests
    drawStorageChests(ctx, states);

    // Smoke / particles
    updateAndDrawParticles(ctx, particlesRef.current, states, frameRef.current);

    // Belt items
    updateAndDrawItems(ctx, itemsRef.current);

    // Workers
    updateAndDrawWorkers(ctx, workersRef.current);

    // Labels
    drawLabels(ctx, states);

    frameRef.current++;
    animRef.current = requestAnimationFrame(gameLoop);
  }, []);

  // ── Start game loop + DB polling ──
  useEffect(() => {
    animRef.current = requestAnimationFrame(gameLoop);
    loadFactoryState();
    const poll = setInterval(loadFactoryState, 12_000);
    return () => {
      cancelAnimationFrame(animRef.current);
      clearInterval(poll);
    };
  }, [gameLoop, loadFactoryState]);

  // ── Render ──
  return (
    <div className="relative w-full h-full bg-[#111208] overflow-hidden" style={{ height: "calc(100vh - 64px)" }}>
      {/* Canvas */}
      <canvas ref={canvasRef} className="w-full h-full" />

      {/* HUD overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 p-3 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
          {/* Left: title */}
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-amber-400 text-sm font-bold tracking-widest">
              FACTORY FLOOR
            </span>
            <span className="font-mono text-xs text-amber-400/50">
              MAVIS Production Network
            </span>
          </div>

          {/* Center: stats */}
          <div className="flex gap-4 font-mono text-xs text-zinc-300">
            <span>
              <span className="text-green-400">●</span>{" "}
              <span className="text-green-400 font-bold">{activeCount}</span>{" "}
              <span className="text-zinc-500">ACTIVE</span>
            </span>
            <span>
              <span className="text-yellow-400">●</span>{" "}
              <span className="text-yellow-400 font-bold">{warmCount}</span>{" "}
              <span className="text-zinc-500">WARM</span>
            </span>
            <span>
              <span className="text-zinc-600">●</span>{" "}
              <span className="text-zinc-500 font-bold">{idleCount}</span>{" "}
              <span className="text-zinc-600">IDLE</span>
            </span>
            <span className="text-amber-400/60">
              ITEMS/MIN:{" "}
              <span className="text-amber-400 font-bold">{itemsPerMin}</span>
            </span>
            <span className="text-cyan-400/60">
              QUESTS:{" "}
              <span className="text-cyan-400 font-bold">
                {machineStates.activeQuests}
              </span>
            </span>
            <span className="text-amber-400/60">
              ORDERS:{" "}
              <span className="text-amber-400 font-bold">
                {machineStates.activeOrders}
              </span>
            </span>
          </div>

          {/* Right: refresh button */}
          <button
            className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900/80 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 font-mono text-xs transition-colors"
            onClick={loadFactoryState}
            disabled={loading}
          >
            <RefreshCw
              size={11}
              className={loading ? "animate-spin" : ""}
            />
            {loading ? "Syncing…" : "Refresh"}
          </button>
        </div>

        {/* Bottom legend */}
        <div className="absolute bottom-0 left-0 right-0 p-3 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent">
          <div className="flex gap-4 font-mono text-[10px] text-zinc-500">
            {(
              [
                { color: ITEM_COLORS.memory, label: "Memory" },
                { color: ITEM_COLORS.journal, label: "Journal" },
                { color: ITEM_COLORS.quest, label: "Quest" },
                { color: ITEM_COLORS.ruview, label: "RuView" },
                { color: ITEM_COLORS.order, label: "Orders" },
                { color: ITEM_COLORS.persona, label: "Persona" },
              ] as const
            ).map((item) => (
              <span key={item.label} className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>

          <button
            className="pointer-events-auto font-mono text-[10px] text-violet-400/60 hover:text-violet-300 transition-colors"
            onClick={() => navigate("/mavis")}
          >
            → Chat with MAVIS
          </button>
        </div>
      </div>
    </div>
  );
}
